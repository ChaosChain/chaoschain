"""
ChaosChain SDK - x402 Server (Paywall) Support

This module provides x402 server functionality for receiving payments.
Enables agents to act as service providers requiring payment before service delivery.
"""

import json
import os
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime, timezone
from rich import print as rprint
from flask import Flask, request, jsonify, Response

# Official Coinbase x402 imports
from x402.types import PaymentRequirements
from x402.exact import decode_payment
from x402.encoding import safe_base64_decode

from .types import NetworkConfig
from .exceptions import PaymentError, ConfigurationError
from .x402_payment_manager import X402PaymentManager


class X402PaywallServer:
    """
    x402 Paywall Server for ChaosChain agents.
    
    Enables agents to act as service providers that require payment before
    delivering services, following the x402 protocol specification.
    
    Key Features:
    - HTTP 402 Payment Required responses
    - x402 payment verification
    - Service delivery after payment confirmation
    - Facilitator integration for verification/settlement
    - ChaosChain fee collection integration
    
    Usage:
        ```python
        # Create paywall server
        server = X402PaywallServer(
            agent_name="ServiceProvider",
            payment_manager=x402_payment_manager
        )
        
        # Register a paid service
        @server.require_payment(amount=1.5, description="AI Analysis")
        def analyze_data(data):
            return {"analysis": "result"}
        
        # Start server
        server.run(host="0.0.0.0", port=8402)
        ```
    """
    
    def __init__(
        self,
        agent_name: str,
        payment_manager: X402PaymentManager,
        app: Optional[Flask] = None
    ):
        """
        Initialize x402 paywall server.
        
        Args:
            agent_name: Name of the agent providing services
            payment_manager: X402PaymentManager instance
            app: Optional Flask app (creates new one if None)
        """
        self.agent_name = agent_name
        self.payment_manager = payment_manager
        self.app = app or Flask(f"x402-{agent_name}")
        
        # Service registry
        self.paid_services: Dict[str, Dict[str, Any]] = {}
        self.payment_cache: Dict[str, Dict[str, Any]] = {}
        
        # Setup routes
        self._setup_routes()
        
        rprint(f"[green]🏛️  x402 Paywall Server initialized for {agent_name}[/green]")
        rprint(f"[blue]💳 Ready to receive x402 payments[/blue]")
    
    def _setup_routes(self):
        """Setup Flask routes for x402 protocol."""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            """Health check endpoint."""
            return jsonify({
                "status": "healthy",
                "agent": self.agent_name,
                "protocol": "x402",
                "services": len(self.paid_services)
            })
        
        @self.app.route('/services', methods=['GET'])
        def list_services():
            """List available paid services."""
            services = []
            for service_id, service_info in self.paid_services.items():
                services.append({
                    "service_id": service_id,
                    "description": service_info["description"],
                    "amount_usdc": service_info["amount"],
                    "resource_path": service_info["resource_path"]
                })
            
            return jsonify({
                "agent": self.agent_name,
                "services": services,
                "payment_protocol": "x402"
            })
    
    def require_payment(
        self,
        amount: float,
        description: str,
        resource_path: Optional[str] = None,
        mime_type: str = "application/json"
    ):
        """
        Decorator to require x402 payment for a service function.
        
        Args:
            amount: Amount in USDC required
            description: Service description
            resource_path: Optional custom resource path
            mime_type: Response MIME type
            
        Returns:
            Decorated function that requires payment
        """
        def decorator(func: Callable):
            # Generate resource path if not provided
            if resource_path is None:
                func_resource_path = f"/chaoschain/service/{func.__name__}"
            else:
                func_resource_path = resource_path
            
            # Register service
            service_id = func.__name__
            self.paid_services[service_id] = {
                "function": func,
                "amount": amount,
                "description": description,
                "resource_path": func_resource_path,
                "mime_type": mime_type
            }
            
            # Create Flask route
            @self.app.route(func_resource_path, methods=['GET', 'POST'])
            def payment_required_endpoint():
                return self._handle_payment_required_request(service_id)
            
            rprint(f"[blue]💰 Registered paid service: {func_resource_path} (${amount} USDC)[/blue]")
            
            return func
        
        return decorator
    
    def _handle_payment_required_request(self, service_id: str) -> Response:
        """
        Handle incoming request for a paid service.
        
        Args:
            service_id: ID of the requested service
            
        Returns:
            Flask Response (402 Payment Required or 200 OK with service)
        """
        service_info = self.paid_services.get(service_id)
        if not service_info:
            return jsonify({"error": "Service not found"}), 404
        
        # Check for X-PAYMENT header
        x_payment_header = request.headers.get('X-PAYMENT')
        
        if not x_payment_header:
            # No payment provided - return 402 Payment Required
            return self._create_payment_required_response(service_info)
        
        # Payment provided - verify and process
        try:
            payment_result = self._verify_and_process_payment(
                x_payment_header, service_info
            )
            
            if payment_result["valid"]:
                # Payment valid - execute service
                return self._execute_paid_service(service_info, payment_result)
            else:
                # Payment invalid - return 402 again
                return self._create_payment_required_response(
                    service_info, 
                    error=payment_result.get("error", "Invalid payment")
                )
                
        except Exception as e:
            rprint(f"[red]❌ Payment processing error: {e}[/red]")
            return self._create_payment_required_response(
                service_info,
                error=f"Payment processing failed: {str(e)}"
            )
    
    def _create_payment_required_response(
        self,
        service_info: Dict[str, Any],
        error: Optional[str] = None
    ) -> Response:
        """
        Create HTTP 402 Payment Required response.
        
        Args:
            service_info: Service information
            error: Optional error message
            
        Returns:
            402 Payment Required response
        """
        try:
            # Create payment requirements
            payment_requirements = self.payment_manager.create_payment_requirements(
                to_agent=self.agent_name,
                amount_usdc=service_info["amount"],
                service_description=service_info["description"]
            )
            
            # Create response body
            response_body = {
                "x402Version": 1,
                "accepts": [payment_requirements.model_dump()]
            }
            
            if error:
                response_body["error"] = error
            
            response = jsonify(response_body)
            response.status_code = 402
            response.headers['Content-Type'] = 'application/json'
            
            rprint(f"[yellow]💳 Payment required for {service_info['description']} (${service_info['amount']} USDC)[/yellow]")
            
            return response
            
        except Exception as e:
            rprint(f"[red]❌ Failed to create payment requirements: {e}[/red]")
            return jsonify({"error": "Payment system unavailable"}), 500
    
    def _verify_and_process_payment(
        self,
        x_payment_header: str,
        service_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Verify x402 payment and process if valid.
        
        Args:
            x_payment_header: Base64 encoded payment header
            service_info: Service information
            
        Returns:
            Payment verification result
        """
        try:
            # Decode payment header
            payment_data = decode_payment(x_payment_header)
            
            # Create payment requirements for verification
            payment_requirements = self.payment_manager.create_payment_requirements(
                to_agent=self.agent_name,
                amount_usdc=service_info["amount"],
                service_description=service_info["description"]
            )
            
            # Use facilitator if configured
            if self.payment_manager.use_facilitator:
                verification_result = self.payment_manager.verify_payment_with_facilitator(
                    {"x_payment_header": x_payment_header},
                    payment_requirements
                )
                
                if verification_result.get("isValid"):
                    # Settle payment via facilitator
                    settlement_result = self.payment_manager.settle_payment_with_facilitator(
                        {"x_payment_header": x_payment_header},
                        payment_requirements
                    )
                    
                    return {
                        "valid": settlement_result.get("success", False),
                        "tx_hash": settlement_result.get("txHash"),
                        "network": settlement_result.get("networkId"),
                        "verification_method": "facilitator"
                    }
                else:
                    return {
                        "valid": False,
                        "error": verification_result.get("invalidReason", "Payment verification failed")
                    }
            
            else:
                # Direct verification (simplified for demo)
                # In production, this would involve full cryptographic verification
                rprint(f"[blue]🔍 Direct payment verification (demo mode)[/blue]")
                
                # Simulate successful verification for demo
                return {
                    "valid": True,
                    "tx_hash": f"0x402demo{int(datetime.now().timestamp())}",
                    "network": self.payment_manager.x402_network,
                    "verification_method": "direct"
                }
                
        except Exception as e:
            return {
                "valid": False,
                "error": f"Payment verification failed: {str(e)}"
            }
    
    def _execute_paid_service(
        self,
        service_info: Dict[str, Any],
        payment_result: Dict[str, Any]
    ) -> Response:
        """
        Execute the paid service after successful payment.
        
        Args:
            service_info: Service information
            payment_result: Payment verification result
            
        Returns:
            Service response with X-PAYMENT-RESPONSE header
        """
        try:
            # Execute the service function
            service_function = service_info["function"]
            
            # Get request data
            if request.method == 'POST':
                request_data = request.get_json() or {}
            else:
                request_data = dict(request.args)
            
            # Execute service
            result = service_function(request_data)
            
            # Create response
            response = jsonify(result)
            response.status_code = 200
            response.headers['Content-Type'] = service_info["mime_type"]
            
            # Add X-PAYMENT-RESPONSE header with settlement info
            settlement_response = {
                "success": True,
                "txHash": payment_result.get("tx_hash"),
                "networkId": payment_result.get("network"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "agent": self.agent_name,
                "service": service_info["description"],
                "amount": service_info["amount"]
            }
            
            response.headers['X-PAYMENT-RESPONSE'] = safe_base64_encode(
                json.dumps(settlement_response).encode()
            )
            
            rprint(f"[green]✅ Service delivered: {service_info['description']} (Paid: ${service_info['amount']} USDC)[/green]")
            
            return response
            
        except Exception as e:
            rprint(f"[red]❌ Service execution failed: {e}[/red]")
            return jsonify({"error": f"Service execution failed: {str(e)}"}), 500
    
    def run(self, host: str = "0.0.0.0", port: int = 8402, debug: bool = False):
        """
        Start the x402 paywall server.
        
        Args:
            host: Host to bind to
            port: Port to listen on (default 8402 for x402)
            debug: Enable debug mode
        """
        rprint(f"[green]🚀 Starting x402 Paywall Server for {self.agent_name}[/green]")
        rprint(f"[blue]🌐 Server: http://{host}:{port}[/blue]")
        rprint(f"[blue]💰 Services: {len(self.paid_services)} paid services available[/blue]")
        
        self.app.run(host=host, port=port, debug=debug)
    
    def get_server_status(self) -> Dict[str, Any]:
        """Get comprehensive server status."""
        return {
            "agent_name": self.agent_name,
            "protocol": "x402",
            "services_count": len(self.paid_services),
            "services": list(self.paid_services.keys()),
            "facilitator_enabled": self.payment_manager.use_facilitator,
            "facilitator_url": self.payment_manager.facilitator_url,
            "network": self.payment_manager.network.value,
            "treasury": self.payment_manager.chaoschain_treasury,
            "protocol_fee": f"{self.payment_manager.protocol_fee_percentage}%"
        }

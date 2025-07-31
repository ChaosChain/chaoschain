"""Agent Relay Network (ARN) client for A2A communication."""

import asyncio
import json
import uuid
from typing import Any, Callable, Dict, List, Optional, Set
from datetime import datetime, timezone

import websockets
import httpx
from loguru import logger


class ARNClient:
    """
    Client for the ChaosChain Agent Relay Network.
    
    Provides A2A-compliant communication via WebSocket connections
    with support for:
    - Message publishing and subscription
    - Channel management
    - Message persistence and routing
    - Agent discovery and presence
    """
    
    def __init__(
        self,
        ws_url: str,
        http_url: str,
        reconnect_attempts: int = 5,
        heartbeat_interval: int = 30
    ):
        """Initialize ARN client."""
        self.ws_url = ws_url
        self.http_url = http_url
        self.reconnect_attempts = reconnect_attempts
        self.heartbeat_interval = heartbeat_interval
        
        # Connection state
        self._websocket: Optional[websockets.WebSocketServerProtocol] = None
        self._connected = False
        self._subscriptions: Set[str] = set()
        self._message_handlers: Dict[str, Callable] = {}
        self._pending_messages: List[Dict[str, Any]] = []
        
        # Message tracking
        self._message_callbacks: Dict[str, asyncio.Future] = {}
        
        # Background tasks
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._message_listener_task: Optional[asyncio.Task] = None
    
    async def connect(self) -> bool:
        """Connect to the ARN WebSocket server."""
        for attempt in range(self.reconnect_attempts):
            try:
                logger.info(f"Connecting to ARN at {self.ws_url} (attempt {attempt + 1})")
                
                self._websocket = await websockets.connect(
                    self.ws_url,
                    ping_interval=self.heartbeat_interval,
                    ping_timeout=10
                )
                
                self._connected = True
                logger.info("Successfully connected to ARN")
                
                # Start background tasks
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                self._message_listener_task = asyncio.create_task(self._message_listener())
                
                # Send any pending messages
                await self._send_pending_messages()
                
                # Re-establish subscriptions
                await self._reestablish_subscriptions()
                
                return True
                
            except Exception as e:
                logger.warning(f"Connection attempt {attempt + 1} failed: {e}")
                if attempt < self.reconnect_attempts - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
                
        logger.error("Failed to connect to ARN after all attempts")
        return False
    
    async def disconnect(self) -> None:
        """Disconnect from the ARN."""
        logger.info("Disconnecting from ARN")
        
        self._connected = False
        
        # Cancel background tasks
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        if self._message_listener_task:
            self._message_listener_task.cancel()
            try:
                await self._message_listener_task
            except asyncio.CancelledError:
                pass
        
        # Close WebSocket connection
        if self._websocket:
            await self._websocket.close()
            self._websocket = None
        
        logger.info("Disconnected from ARN")
    
    async def subscribe(self, channel: str) -> bool:
        """Subscribe to a channel."""
        if channel in self._subscriptions:
            logger.debug(f"Already subscribed to channel: {channel}")
            return True
        
        message = {
            "type": "subscribe",
            "channel": channel,
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        success = await self._send_message(message)
        if success:
            self._subscriptions.add(channel)
            logger.info(f"Subscribed to channel: {channel}")
        
        return success
    
    async def unsubscribe(self, channel: str) -> bool:
        """Unsubscribe from a channel."""
        if channel not in self._subscriptions:
            logger.debug(f"Not subscribed to channel: {channel}")
            return True
        
        message = {
            "type": "unsubscribe",
            "channel": channel,
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        success = await self._send_message(message)
        if success:
            self._subscriptions.remove(channel)
            logger.info(f"Unsubscribed from channel: {channel}")
        
        return success
    
    async def send_message(self, message_data: Dict[str, Any]) -> str:
        """
        Send an A2A message.
        
        Args:
            message_data: A2A message dictionary
            
        Returns:
            Message ID
        """
        message_id = message_data.get("id", str(uuid.uuid4()))
        
        message = {
            "type": "message",
            "id": message_id,
            "data": message_data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        success = await self._send_message(message)
        if success:
            logger.debug(f"Sent A2A message: {message_id}")
        else:
            logger.error(f"Failed to send A2A message: {message_id}")
        
        return message_id
    
    async def publish_to_channel(
        self,
        channel: str,
        message_data: Dict[str, Any]
    ) -> str:
        """
        Publish a message to a specific channel.
        
        Args:
            channel: Target channel
            message_data: Message content
            
        Returns:
            Message ID
        """
        message_id = str(uuid.uuid4())
        
        message = {
            "type": "publish",
            "channel": channel,
            "id": message_id,
            "data": message_data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        success = await self._send_message(message)
        if success:
            logger.debug(f"Published to channel {channel}: {message_id}")
        else:
            logger.error(f"Failed to publish to channel {channel}: {message_id}")
        
        return message_id
    
    async def request_response(
        self,
        message_data: Dict[str, Any],
        timeout: float = 30.0
    ) -> Optional[Dict[str, Any]]:
        """
        Send a message and wait for a response.
        
        Args:
            message_data: A2A message
            timeout: Response timeout in seconds
            
        Returns:
            Response message or None if timeout
        """
        message_id = message_data.get("id", str(uuid.uuid4()))
        message_data["id"] = message_id
        
        # Create future for response
        response_future = asyncio.Future()
        self._message_callbacks[message_id] = response_future
        
        try:
            # Send message
            await self.send_message(message_data)
            
            # Wait for response
            response = await asyncio.wait_for(response_future, timeout=timeout)
            return response
            
        except asyncio.TimeoutError:
            logger.warning(f"Request timeout for message: {message_id}")
            return None
        finally:
            # Clean up callback
            self._message_callbacks.pop(message_id, None)
    
    def add_message_handler(self, message_type: str, handler: Callable) -> None:
        """Add a handler for specific message types."""
        self._message_handlers[message_type] = handler
        logger.debug(f"Added message handler for type: {message_type}")
    
    def remove_message_handler(self, message_type: str) -> None:
        """Remove a message handler."""
        self._message_handlers.pop(message_type, None)
        logger.debug(f"Removed message handler for type: {message_type}")
    
    async def get_channel_info(self, channel: str) -> Optional[Dict[str, Any]]:
        """Get information about a channel via HTTP API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.http_url}/channels/{channel}")
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.warning(f"Failed to get channel info: {response.status_code}")
                    return None
        except Exception as e:
            logger.error(f"Error getting channel info: {e}")
            return None
    
    async def discover_agents(self, capabilities: List[str] = None) -> List[Dict[str, Any]]:
        """Discover active agents with optional capability filtering."""
        try:
            params = {}
            if capabilities:
                params["capabilities"] = ",".join(capabilities)
            
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.http_url}/agents/discover", params=params)
                if response.status_code == 200:
                    return response.json().get("agents", [])
                else:
                    logger.warning(f"Failed to discover agents: {response.status_code}")
                    return []
        except Exception as e:
            logger.error(f"Error discovering agents: {e}")
            return []
    
    async def _send_message(self, message: Dict[str, Any]) -> bool:
        """Send a message via WebSocket."""
        if not self._connected or not self._websocket:
            # Queue message for later
            self._pending_messages.append(message)
            logger.debug("Queued message for later (not connected)")
            return False
        
        try:
            message_str = json.dumps(message)
            await self._websocket.send(message_str)
            return True
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            self._connected = False
            # Queue message for retry
            self._pending_messages.append(message)
            return False
    
    async def _send_pending_messages(self) -> None:
        """Send all pending messages."""
        if not self._pending_messages:
            return
        
        logger.info(f"Sending {len(self._pending_messages)} pending messages")
        
        pending = self._pending_messages.copy()
        self._pending_messages.clear()
        
        for message in pending:
            await self._send_message(message)
    
    async def _reestablish_subscriptions(self) -> None:
        """Re-establish all subscriptions after reconnection."""
        if not self._subscriptions:
            return
        
        logger.info(f"Re-establishing {len(self._subscriptions)} subscriptions")
        
        subscriptions = self._subscriptions.copy()
        self._subscriptions.clear()
        
        for channel in subscriptions:
            await self.subscribe(channel)
    
    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeat messages."""
        while self._connected:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                
                if self._connected and self._websocket:
                    heartbeat = {
                        "type": "heartbeat",
                        "id": str(uuid.uuid4()),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await self._send_message(heartbeat)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                self._connected = False
                break
    
    async def _message_listener(self) -> None:
        """Listen for incoming messages."""
        while self._connected:
            try:
                if not self._websocket:
                    break
                
                message_str = await self._websocket.recv()
                message = json.loads(message_str)
                
                # Handle different message types
                await self._handle_incoming_message(message)
                
            except asyncio.CancelledError:
                break
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket connection closed")
                self._connected = False
                break
            except Exception as e:
                logger.error(f"Message listener error: {e}")
                break
    
    async def _handle_incoming_message(self, message: Dict[str, Any]) -> None:
        """Handle incoming messages from ARN."""
        message_type = message.get("type", "unknown")
        message_id = message.get("id")
        
        logger.debug(f"Received message type: {message_type}")
        
        try:
            if message_type == "response" and message_id:
                # Handle response to request
                future = self._message_callbacks.get(message_id)
                if future and not future.done():
                    future.set_result(message.get("data"))
            
            elif message_type == "message":
                # Handle A2A message
                data = message.get("data", {})
                if data.get("method") in self._message_handlers:
                    handler = self._message_handlers[data["method"]]
                    await handler(data)
            
            elif message_type == "broadcast":
                # Handle broadcast message
                if "broadcast" in self._message_handlers:
                    handler = self._message_handlers["broadcast"]
                    await handler(message.get("data"))
            
            elif message_type == "error":
                logger.error(f"ARN error: {message.get('error', 'Unknown error')}")
            
            # Call generic handler if available
            if "any" in self._message_handlers:
                handler = self._message_handlers["any"]
                await handler(message)
                
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    @property
    def is_connected(self) -> bool:
        """Check if client is connected to ARN."""
        return self._connected
    
    @property
    def subscriptions(self) -> Set[str]:
        """Get current subscriptions."""
        return self._subscriptions.copy()
    
    async def get_connection_stats(self) -> Dict[str, Any]:
        """Get connection statistics."""
        return {
            "connected": self._connected,
            "subscriptions": len(self._subscriptions),
            "pending_messages": len(self._pending_messages),
            "active_callbacks": len(self._message_callbacks),
            "ws_url": self.ws_url,
            "http_url": self.http_url
        } 
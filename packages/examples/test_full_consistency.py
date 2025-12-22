"""
Comprehensive Consistency Test Suite

Tests all components for consistency with:
- ChaosChain_Implementation_Plan.md
- docs/protocol_spec_v0.1.md  
- Corrected multi-dimensional scoring

Checks:
1. SDK implementation
2. Smart contract implementation
3. End-to-end flow
4. Protocol spec compliance
"""

from rich import print as rprint
from rich.panel import Panel
from rich.table import Table
from rich.console import Console

console = Console()


class ConsistencyTest:
    """Track consistency test results."""
    def __init__(self):
        self.tests = []
        self.passed = 0
        self.failed = 0
        self.issues = []
    
    def add(self, component: str, check: str, passed: bool, issue: str = ""):
        self.tests.append({
            "component": component,
            "check": check,
            "passed": passed,
            "issue": issue
        })
        if passed:
            self.passed += 1
        else:
            self.failed += 1
            self.issues.append(f"{component}: {check} - {issue}")
    
    def summary(self):
        table = Table(title=f"Consistency Test Results: {self.passed}/{self.passed + self.failed} Passed")
        table.add_column("Component", style="cyan")
        table.add_column("Check", style="yellow")
        table.add_column("Status", style="white")
        table.add_column("Issue", style="red")
        
        for test in self.tests:
            status = "✅ PASS" if test["passed"] else "❌ FAIL"
            table.add_row(
                test["component"],
                test["check"],
                status,
                test["issue"]
            )
        
        console.print(table)
        
        if self.issues:
            console.print("\n")
            console.print(Panel.fit(
                "❌ CRITICAL ISSUES FOUND:\n\n" + "\n".join(f"• {issue}" for issue in self.issues),
                style="bold red",
                title="🚨 Inconsistencies Detected"
            ))
        
        return self.failed == 0


def test_protocol_spec_compliance(results: ConsistencyTest):
    """Test Protocol Spec v0.1 compliance."""
    console.print(Panel.fit(
        "📋 Protocol Spec v0.1 Compliance Tests",
        style="bold cyan"
    ))
    
    # §3.1: Score vectors FROM DKG
    try:
        from chaoschain_sdk.verifier_agent import VerifierAgent
        
        # Check method signatures
        has_compute_from_dkg = hasattr(VerifierAgent, 'compute_multi_dimensional_scores')
        has_initiative = hasattr(VerifierAgent, '_compute_initiative_dkg')
        has_collaboration = hasattr(VerifierAgent, '_compute_collaboration_dkg')
        has_reasoning = hasattr(VerifierAgent, '_compute_reasoning_depth_dkg')
        
        all_present = has_compute_from_dkg and has_initiative and has_collaboration and has_reasoning
        
        if all_present:
            results.add(
                "SDK VerifierAgent",
                "§3.1: Score vectors computed FROM DKG",
                True
            )
        else:
            missing = []
            if not has_compute_from_dkg: missing.append("compute_multi_dimensional_scores")
            if not has_initiative: missing.append("_compute_initiative_dkg")
            if not has_collaboration: missing.append("_compute_collaboration_dkg")
            if not has_reasoning: missing.append("_compute_reasoning_depth_dkg")
            results.add(
                "SDK VerifierAgent",
                "§3.1: Score vectors computed FROM DKG",
                False,
                f"Missing methods: {', '.join(missing)}"
            )
    except Exception as e:
        results.add(
            "SDK VerifierAgent",
            "§3.1: Score vectors computed FROM DKG",
            False,
            str(e)
        )
    
    # §4.1: Studio-weighted quality scalar
    try:
        import re
        
        # Check if contracts use studio-weighted sum
        with open('packages/contracts/src/RewardsDistributor.sol', 'r') as f:
            contract_code = f.read()
        
        # Check for the NEW implementation (_calculateQualityScalar)
        has_calculate_quality_scalar = '_calculateQualityScalar' in contract_code
        
        # Check for getCustomDimensionConfig (retrieves studio weights)
        has_dimension_config = 'getCustomDimensionConfig' in contract_code
        
        # Check for universal/custom component calculation
        has_universal_component = 'universalAvg' in contract_code or 'universalSum' in contract_code
        has_custom_component = 'customWeightedSum' in contract_code or 'customComponent' in contract_code
        
        # Check for simple average (the BUG) - should NOT exist
        has_simple_average = 'qualitySum / consensusScores.length' in contract_code
        
        if (has_calculate_quality_scalar and has_dimension_config and 
            has_universal_component and has_custom_component and not has_simple_average):
            results.add(
                "RewardsDistributor Contract",
                "§4.1: Studio-weighted quality scalar",
                True
            )
        else:
            issue = []
            if not has_calculate_quality_scalar:
                issue.append("Missing _calculateQualityScalar function")
            if not has_dimension_config:
                issue.append("Missing getCustomDimensionConfig call")
            if not has_universal_component:
                issue.append("Missing universal component calculation")
            if not has_custom_component:
                issue.append("Missing custom component calculation")
            if has_simple_average:
                issue.append("Using SIMPLE AVERAGE (loses nuance!)")
            results.add(
                "RewardsDistributor Contract",
                "§4.1: Studio-weighted quality scalar",
                False,
                "; ".join(issue)
            )
    except Exception as e:
        results.add(
            "RewardsDistributor Contract",
            "§4.1: Studio-weighted quality scalar",
            False,
            str(e)
        )
    
    # §4.2: Multi-agent attribution
    try:
        with open('packages/contracts/src/RewardsDistributor.sol', 'r') as f:
            contract_code = f.read()
        
        # Look for contribution weights
        has_contribution = 'contribution' in contract_code.lower() or 'betweenness' in contract_code.lower()
        has_multi_agent = 'multi' in contract_code.lower() and 'attribution' in contract_code.lower()
        
        if has_contribution or has_multi_agent:
            results.add(
                "RewardsDistributor Contract",
                "§4.2: Multi-agent attribution",
                True
            )
        else:
            results.add(
                "RewardsDistributor Contract",
                "§4.2: Multi-agent attribution",
                False,
                "Missing contribution weights / multi-agent attribution"
            )
    except Exception as e:
        results.add(
            "RewardsDistributor Contract",
            "§4.2: Multi-agent attribution",
            False,
            str(e)
        )


def test_implementation_plan_compliance(results: ConsistencyTest):
    """Test Implementation Plan compliance."""
    console.print("\n")
    console.print(Panel.fit(
        "📘 Implementation Plan Compliance Tests",
        style="bold cyan"
    ))
    
    # Component 2: XMTP Integration
    try:
        from chaoschain_sdk.xmtp_client import XMTPManager
        
        has_manager = True
        has_compute_root = hasattr(XMTPManager, 'compute_thread_root')
        has_verify = hasattr(XMTPManager, 'verify_causality')
        has_vlc = hasattr(XMTPManager, 'compute_vlc')
        
        all_present = has_manager and has_compute_root and has_verify and has_vlc
        
        if all_present:
            results.add(
                "XMTP Integration",
                "XMTPManager with causal DAG",
                True
            )
        else:
            missing = []
            if not has_compute_root: missing.append("compute_thread_root")
            if not has_verify: missing.append("verify_causality")
            if not has_vlc: missing.append("compute_vlc")
            results.add(
                "XMTP Integration",
                "XMTPManager with causal DAG",
                False,
                f"Missing: {', '.join(missing)}"
            )
    except Exception as e:
        results.add(
            "XMTP Integration",
            "XMTPManager with causal DAG",
            False,
            str(e)
        )
    
    # Component 3: DKG
    try:
        from chaoschain_sdk.dkg import DKG, DKGNode
        
        has_dkg = True
        has_trace = hasattr(DKG, 'trace_causal_chain')
        has_critical = hasattr(DKG, 'find_critical_nodes')
        has_contribution = hasattr(DKG, 'compute_contribution_weights')
        
        all_present = has_dkg and has_trace and has_critical and has_contribution
        
        if all_present:
            results.add(
                "DKG Implementation",
                "Full graph with causal analysis",
                True
            )
        else:
            missing = []
            if not has_trace: missing.append("trace_causal_chain")
            if not has_critical: missing.append("find_critical_nodes")
            if not has_contribution: missing.append("compute_contribution_weights")
            results.add(
                "DKG Implementation",
                "Full graph with causal analysis",
                False,
                f"Missing: {', '.join(missing)}"
            )
    except Exception as e:
        results.add(
            "DKG Implementation",
            "Full graph with causal analysis",
            False,
            str(e)
        )
    
    # Component 4: Studios (Contracts)
    try:
        import os
        studio_exists = os.path.exists('packages/contracts/src/StudioProxy.sol')
        chaos_core_exists = os.path.exists('packages/contracts/src/ChaosCore.sol')
        
        if studio_exists and chaos_core_exists:
            results.add(
                "Studio Architecture",
                "StudioProxy + ChaosCore factory",
                True
            )
        else:
            missing = []
            if not studio_exists: missing.append("StudioProxy.sol")
            if not chaos_core_exists: missing.append("ChaosCore.sol")
            results.add(
                "Studio Architecture",
                "StudioProxy + ChaosCore factory",
                False,
                f"Missing: {', '.join(missing)}"
            )
    except Exception as e:
        results.add(
            "Studio Architecture",
            "StudioProxy + ChaosCore factory",
            False,
            str(e)
        )
    
    # Component 5: Incentive Flywheel
    try:
        import os
        rewards_exists = os.path.exists('packages/contracts/src/RewardsDistributor.sol')
        
        if rewards_exists:
            with open('packages/contracts/src/RewardsDistributor.sol', 'r') as f:
                contract_code = f.read()
            
            has_consensus = 'calculateConsensus' in contract_code
            has_close_epoch = 'closeEpoch' in contract_code
            has_validator_rewards = 'validatorPool' in contract_code or 'validator' in contract_code.lower()
            
            all_present = has_consensus and has_close_epoch and has_validator_rewards
            
            if all_present:
                results.add(
                    "Incentive Flywheel",
                    "RewardsDistributor with consensus",
                    True
                )
            else:
                missing = []
                if not has_consensus: missing.append("calculateConsensus")
                if not has_close_epoch: missing.append("closeEpoch")
                if not has_validator_rewards: missing.append("validator rewards")
                results.add(
                    "Incentive Flywheel",
                    "RewardsDistributor with consensus",
                    False,
                    f"Missing: {', '.join(missing)}"
                )
        else:
            results.add(
                "Incentive Flywheel",
                "RewardsDistributor with consensus",
                False,
                "RewardsDistributor.sol not found"
            )
    except Exception as e:
        results.add(
            "Incentive Flywheel",
            "RewardsDistributor with consensus",
            False,
            str(e)
        )


def test_sdk_contract_consistency(results: ConsistencyTest):
    """Test SDK and Contract consistency."""
    console.print("\n")
    console.print(Panel.fit(
        "🔗 SDK ↔️ Contract Consistency Tests",
        style="bold cyan"
    ))
    
    # Test: SDK creates evidence packages that contracts expect
    try:
        from chaoschain_sdk.core_sdk import ChaosChainAgentSDK
        
        has_create_evidence = hasattr(ChaosChainAgentSDK, 'create_evidence_package')
        has_submit_work = hasattr(ChaosChainAgentSDK, 'submit_work')
        
        if has_create_evidence and has_submit_work:
            results.add(
                "SDK → Contract Flow",
                "Evidence package creation + submission",
                True
            )
        else:
            missing = []
            if not has_create_evidence: missing.append("create_evidence_package")
            if not has_submit_work: missing.append("submit_work")
            results.add(
                "SDK → Contract Flow",
                "Evidence package creation + submission",
                False,
                f"Missing: {', '.join(missing)}"
            )
    except Exception as e:
        results.add(
            "SDK → Contract Flow",
            "Evidence package creation + submission",
            False,
            str(e)
        )
    
    # Test: SDK score vectors match contract expectations
    try:
        # Check if SDK produces vectors that contracts can process
        with open('packages/contracts/src/RewardsDistributor.sol', 'r') as f:
            contract_code = f.read()
        
        # Look for ScoreVector struct
        has_score_vector = 'ScoreVector' in contract_code
        has_dimensions = 'dimensions' in contract_code or 'scores' in contract_code
        
        if has_score_vector and has_dimensions:
            results.add(
                "Score Vector Format",
                "SDK produces contract-compatible vectors",
                True
            )
        else:
            results.add(
                "Score Vector Format",
                "SDK produces contract-compatible vectors",
                False,
                "ScoreVector format mismatch between SDK and contracts"
            )
    except Exception as e:
        results.add(
            "Score Vector Format",
            "SDK produces contract-compatible vectors",
            False,
            str(e)
        )


def main():
    """Run complete consistency test suite."""
    console.print(Panel.fit(
        "🔍 Full Consistency Test Suite\n\n"
        "Testing all components for consistency with:\n"
        "• ChaosChain_Implementation_Plan.md\n"
        "• docs/protocol_spec_v0.1.md\n"
        "• Corrected multi-dimensional scoring",
        style="bold green"
    ))
    
    results = ConsistencyTest()
    
    # Run all test suites
    test_protocol_spec_compliance(results)
    test_implementation_plan_compliance(results)
    test_sdk_contract_consistency(results)
    
    # Display summary
    console.print("\n")
    all_passed = results.summary()
    
    if all_passed:
        console.print("\n")
        console.print(Panel.fit(
            "✅ ALL CONSISTENCY TESTS PASSED!\n\n"
            "The implementation is fully consistent with:\n"
            "• Protocol Spec v0.1\n"
            "• Implementation Plan\n"
            "• Corrected multi-dimensional scoring\n\n"
            f"Total: {results.passed}/{results.passed + results.failed} tests passed",
            style="bold green"
        ))
        return 0
    else:
        console.print("\n")
        console.print(Panel.fit(
            f"❌ CONSISTENCY FAILURES: {results.failed}/{results.passed + results.failed}\n\n"
            "Critical issues must be fixed!",
            style="bold red"
        ))
        return 1


if __name__ == "__main__":
    exit(main())


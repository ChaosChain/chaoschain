// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DebugTest {
    event TestEvent(string message, uint256 value);
    
    function testEmit() external {
        emit TestEvent("HELLO_WORLD", 12345);
    }
}


/**
 * XMTP Module
 * 
 * Provides XMTP integration for evidence collection.
 * 
 * CRITICAL INVARIANT:
 * XMTP is COMMUNICATION FABRIC, not a control plane.
 * Gateway fetches and archives messages as evidence.
 * Gateway does NOT parse, interpret, or react to message content.
 */

// Type-only exports
export type { XmtpMessage, XmtpGatewayClient, XmtpClientConfig } from './client.js';

// Value exports
export { XmtpAdapter, MockXmtpAdapter } from './client.js';

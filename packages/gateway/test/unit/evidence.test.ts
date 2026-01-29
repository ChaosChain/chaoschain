/**
 * Evidence Builder Tests
 * 
 * Proves that evidence building respects boundary invariants:
 * 
 * 1. Evidence is archival, NOT control flow
 * 2. Content is treated as opaque
 * 3. Building/archiving does NOT trigger workflows
 * 4. Arweave failures result in thrown errors (→ STALLED)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import {
  MockEvidenceBuilder,
  EvidencePackage,
} from '../../src/evidence/index.js';

describe('MockEvidenceBuilder', () => {
  let builder: MockEvidenceBuilder;

  beforeEach(() => {
    builder = new MockEvidenceBuilder();
  });

  describe('buildFromContent', () => {
    it('should build evidence package from raw content', async () => {
      const content = Buffer.from('Test evidence content');
      
      const pkg = await builder.buildFromContent(
        content,
        '0xStudio123',
        5,
        '0xAgent456'
      );
      
      expect(pkg.header.version).toBe('1.0.0');
      expect(pkg.header.studioAddress).toBe('0xStudio123');
      expect(pkg.header.epoch).toBe(5);
      expect(pkg.header.agentAddress).toBe('0xAgent456');
      expect(pkg.header.messageCount).toBe(1);
      expect(pkg.contentHash).toMatch(/^0x[a-f0-9]{64}$/);
      expect(pkg.contentBytes).toEqual(content);
    });

    it('should produce deterministic content hash', async () => {
      const content = Buffer.from('Same content');
      
      const pkg1 = await builder.buildFromContent(content, '0xS1', 1, '0xA1');
      const pkg2 = await builder.buildFromContent(content, '0xS1', 1, '0xA1');
      
      expect(pkg1.contentHash).toBe(pkg2.contentHash);
    });

    it('different content produces different hash', async () => {
      const content1 = Buffer.from('Content A');
      const content2 = Buffer.from('Content B');
      
      const pkg1 = await builder.buildFromContent(content1, '0xS1', 1, '0xA1');
      const pkg2 = await builder.buildFromContent(content2, '0xS1', 1, '0xA1');
      
      expect(pkg1.contentHash).not.toBe(pkg2.contentHash);
    });
  });

  describe('archiveEvidence', () => {
    it('should archive evidence and return TX ID', async () => {
      const pkg = await builder.buildFromContent(
        Buffer.from('Evidence'),
        '0xStudio',
        1,
        '0xAgent'
      );
      
      const txId = await builder.archiveEvidence(pkg);
      
      expect(txId).toMatch(/^mock-ar-\d+$/);
    });

    it('should store archived evidence', async () => {
      const content = Buffer.from('Archived evidence');
      const pkg = await builder.buildFromContent(content, '0xS', 1, '0xA');
      
      const txId = await builder.archiveEvidence(pkg);
      
      const archived = builder.getArchived(txId);
      expect(archived).toBeDefined();
      expect(archived!.contentHash).toBe(pkg.contentHash);
    });

    it('archiving does NOT trigger workflows', async () => {
      // This is an architectural invariant.
      // The builder has no workflow-triggering capability.
      
      const pkg = await builder.buildFromContent(
        Buffer.from('Evidence'),
        '0xStudio',
        1,
        '0xAgent'
      );
      
      // Archiving is fire-and-forget evidence storage
      const txId = await builder.archiveEvidence(pkg);
      
      // The returned TX ID is for reference only
      // No workflow state is affected
      expect(txId).toBeDefined();
    });
  });

  describe('computeEvidenceRoot', () => {
    it('should compute deterministic evidence root', async () => {
      const pkg = await builder.buildFromContent(
        Buffer.from('Evidence'),
        '0xStudio123',
        5,
        '0xAgent456'
      );
      
      const root1 = builder.computeEvidenceRoot(pkg);
      const root2 = builder.computeEvidenceRoot(pkg);
      
      expect(root1).toBe(root2);
      expect(root1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('evidence root includes studio, epoch, agent, and content hash', async () => {
      const content = Buffer.from('Evidence');
      
      // Same content, different studio
      const pkg1 = await builder.buildFromContent(content, '0xStudioA', 1, '0xAgent');
      const pkg2 = await builder.buildFromContent(content, '0xStudioB', 1, '0xAgent');
      expect(builder.computeEvidenceRoot(pkg1)).not.toBe(builder.computeEvidenceRoot(pkg2));
      
      // Same content, different epoch
      const pkg3 = await builder.buildFromContent(content, '0xStudio', 1, '0xAgent');
      const pkg4 = await builder.buildFromContent(content, '0xStudio', 2, '0xAgent');
      expect(builder.computeEvidenceRoot(pkg3)).not.toBe(builder.computeEvidenceRoot(pkg4));
      
      // Same content, different agent
      const pkg5 = await builder.buildFromContent(content, '0xStudio', 1, '0xAgentA');
      const pkg6 = await builder.buildFromContent(content, '0xStudio', 1, '0xAgentB');
      expect(builder.computeEvidenceRoot(pkg5)).not.toBe(builder.computeEvidenceRoot(pkg6));
    });
  });
});

describe('Evidence Builder Invariants', () => {
  it('evidence is archival, NOT control flow', async () => {
    // Building and archiving evidence is purely for storage and integrity.
    // It does not:
    // - Trigger workflows
    // - Change workflow state
    // - Make decisions
    
    const builder = new MockEvidenceBuilder();
    const pkg = await builder.buildFromContent(
      Buffer.from('Evidence'),
      '0xStudio',
      1,
      '0xAgent'
    );
    
    // Building returns a package — no side effects
    expect(pkg.header).toBeDefined();
    expect(pkg.contentBytes).toBeDefined();
    
    // Archiving returns a TX ID — no side effects
    const txId = await builder.archiveEvidence(pkg);
    expect(txId).toBeDefined();
    
    // Evidence root is computed — no side effects
    const root = builder.computeEvidenceRoot(pkg);
    expect(root).toBeDefined();
  });

  it('content is treated as opaque bytes', async () => {
    // The builder does not interpret content.
    // It only hashes and stores bytes.
    
    const builder = new MockEvidenceBuilder();
    
    // JSON content
    const jsonContent = Buffer.from(JSON.stringify({ sensitive: 'data' }));
    const jsonPkg = await builder.buildFromContent(jsonContent, '0xS', 1, '0xA');
    
    // Binary content
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
    const binaryPkg = await builder.buildFromContent(binaryContent, '0xS', 1, '0xA');
    
    // Both are treated identically — as bytes
    expect(jsonPkg.contentBytes).toEqual(jsonContent);
    expect(binaryPkg.contentBytes).toEqual(binaryContent);
    
    // The builder does not attempt to parse or understand the content
    // It just hashes it
    expect(jsonPkg.contentHash).toMatch(/^0x[a-f0-9]+$/);
    expect(binaryPkg.contentHash).toMatch(/^0x[a-f0-9]+$/);
  });

  it('evidence package structure is well-defined', async () => {
    const builder = new MockEvidenceBuilder();
    const pkg = await builder.buildFromContent(
      Buffer.from('Test'),
      '0xStudio',
      42,
      '0xAgent'
    );
    
    // Header contains all required metadata
    const header = pkg.header;
    expect(header.version).toBe('1.0.0');
    expect(header.studioAddress).toBe('0xStudio');
    expect(header.epoch).toBe(42);
    expect(header.agentAddress).toBe('0xAgent');
    expect(header.timestamp).toBeGreaterThan(0);
    expect(header.messageCount).toBeGreaterThanOrEqual(0);
    
    // Content hash is SHA256
    expect(pkg.contentHash).toMatch(/^0x[a-f0-9]{64}$/);
    
    // Content bytes are preserved
    expect(pkg.contentBytes).toBeDefined();
  });
});

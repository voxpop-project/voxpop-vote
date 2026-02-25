/**
 * VoxPop -- Unit Tests for the SHA-256 MerkleTree
 *
 * Tests the standalone binary Merkle tree implementation used for
 * voter registry snapshots and independent audit verification.
 *
 * Covers:
 * - Tree construction and leaf insertion
 * - Root computation and determinism
 * - Merkle proof generation
 * - Merkle proof verification
 * - Batch insertion
 * - Edge cases (empty tree, single leaf, power-of-two boundaries)
 *
 * @license AGPL-3.0-or-later
 */

import { createHash } from "crypto";
import { MerkleTree, merkleHash } from "../../src/core/merkle-tree";

/** Utility: compute SHA-256 hex hash */
function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ============================================================
// Basic Construction
// ============================================================

describe("MerkleTree — Construction", () => {
  it("should start with zero leaves", () => {
    const tree = new MerkleTree();
    expect(tree.leafCount).toBe(0);
  });

  it("should insert a leaf and increase count", () => {
    const tree = new MerkleTree();
    const idx = tree.insert(sha256("leaf-0"));

    expect(idx).toBe(0);
    expect(tree.leafCount).toBe(1);
  });

  it("should insert multiple leaves with sequential indices", () => {
    const tree = new MerkleTree();
    const idx0 = tree.insert(sha256("a"));
    const idx1 = tree.insert(sha256("b"));
    const idx2 = tree.insert(sha256("c"));

    expect(idx0).toBe(0);
    expect(idx1).toBe(1);
    expect(idx2).toBe(2);
    expect(tree.leafCount).toBe(3);
  });

  it("should return a deterministic root for the same leaves", () => {
    const leaves = ["alpha", "beta", "gamma", "delta"].map(sha256);

    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();

    for (const leaf of leaves) {
      tree1.insert(leaf);
      tree2.insert(leaf);
    }

    expect(tree1.root).toBe(tree2.root);
  });

  it("should produce different roots for different leaves", () => {
    const tree1 = new MerkleTree();
    tree1.insert(sha256("a"));
    tree1.insert(sha256("b"));

    const tree2 = new MerkleTree();
    tree2.insert(sha256("c"));
    tree2.insert(sha256("d"));

    expect(tree1.root).not.toBe(tree2.root);
  });
});

// ============================================================
// Root Computation
// ============================================================

describe("MerkleTree — Root", () => {
  it("should return a 64-character hex root", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("leaf"));

    expect(tree.root).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should handle an empty tree gracefully", () => {
    const tree = new MerkleTree();
    // Empty tree returns the EMPTY_LEAF sentinel hash
    expect(tree.root).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should change root when a new leaf is added", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("first"));
    const root1 = tree.root;

    tree.insert(sha256("second"));
    const root2 = tree.root;

    expect(root1).not.toBe(root2);
  });

  it("should compute correct depth for various sizes", () => {
    const tree = new MerkleTree();

    expect(tree.depth).toBe(0); // 0 leaves

    tree.insert(sha256("a"));
    expect(tree.depth).toBe(0); // 1 leaf

    tree.insert(sha256("b"));
    expect(tree.depth).toBe(1); // 2 leaves

    tree.insert(sha256("c"));
    expect(tree.depth).toBe(2); // 3 leaves -> padded to 4

    tree.insert(sha256("d"));
    expect(tree.depth).toBe(2); // 4 leaves (exact power of 2)

    tree.insert(sha256("e"));
    expect(tree.depth).toBe(3); // 5 leaves -> padded to 8
  });
});

// ============================================================
// Merkle Proof Generation & Verification
// ============================================================

describe("MerkleTree — Proofs", () => {
  it("should generate a valid proof for a single-leaf tree", () => {
    const tree = new MerkleTree();
    const leaf = sha256("only-leaf");
    tree.insert(leaf);

    const proof = tree.getProof(0);

    expect(proof.leaf).toBe(leaf);
    expect(proof.root).toBe(tree.root);
    expect(MerkleTree.verify(proof)).toBe(true);
  });

  it("should generate valid proofs for all leaves in a 4-leaf tree", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b", "c", "d"].map(sha256);

    for (const leaf of leaves) {
      tree.insert(leaf);
    }

    for (let i = 0; i < 4; i++) {
      const proof = tree.getProof(i);
      expect(proof.leaf).toBe(leaves[i]);
      expect(MerkleTree.verify(proof)).toBe(true);
    }
  });

  it("should generate valid proofs for a non-power-of-two tree", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b", "c", "d", "e", "f", "g"].map(sha256);

    for (const leaf of leaves) {
      tree.insert(leaf);
    }

    // 7 leaves -> padded to 8
    expect(tree.leafCount).toBe(7);

    for (let i = 0; i < 7; i++) {
      const proof = tree.getProof(i);
      expect(MerkleTree.verify(proof)).toBe(true);
    }
  });

  it("should generate valid proofs for a large tree (100 leaves)", () => {
    const tree = new MerkleTree();

    for (let i = 0; i < 100; i++) {
      tree.insert(sha256(`voter-commitment-${i}`));
    }

    // Verify a sample of proofs
    for (const idx of [0, 1, 50, 73, 99]) {
      const proof = tree.getProof(idx);
      expect(MerkleTree.verify(proof)).toBe(true);
    }
  });

  it("should reject a proof with a tampered leaf", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("real-leaf"));
    tree.insert(sha256("another-leaf"));

    const proof = tree.getProof(0);

    // Tamper with the leaf
    const tampered = { ...proof, leaf: sha256("fake-leaf") };
    expect(MerkleTree.verify(tampered)).toBe(false);
  });

  it("should reject a proof with a tampered path element", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("a"));
    tree.insert(sha256("b"));
    tree.insert(sha256("c"));
    tree.insert(sha256("d"));

    const proof = tree.getProof(0);

    // Tamper with a path element
    const tampered = {
      ...proof,
      pathElements: [sha256("tampered"), ...proof.pathElements.slice(1)],
    };
    expect(MerkleTree.verify(tampered)).toBe(false);
  });

  it("should reject a proof with a wrong root", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("leaf"));

    const proof = tree.getProof(0);
    const tampered = { ...proof, root: sha256("wrong-root") };
    expect(MerkleTree.verify(tampered)).toBe(false);
  });

  it("should throw when proof index is out of range", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("a"));

    expect(() => tree.getProof(-1)).toThrow("out of range");
    expect(() => tree.getProof(1)).toThrow("out of range");
    expect(() => tree.getProof(100)).toThrow("out of range");
  });

  it("should include correct path indices", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("a"));
    tree.insert(sha256("b"));

    const proofLeft = tree.getProof(0);
    const proofRight = tree.getProof(1);

    // Leaf 0 is on the left, its sibling is on the right
    expect(proofLeft.pathIndices[0]).toBe(0);
    // Leaf 1 is on the right, its sibling is on the left
    expect(proofRight.pathIndices[0]).toBe(1);
  });
});

// ============================================================
// Batch Insertion
// ============================================================

describe("MerkleTree — Batch", () => {
  it("should insert a batch of leaves", () => {
    const tree = new MerkleTree();
    const leaves = ["x", "y", "z"].map(sha256);

    const indices = tree.insertBatch(leaves);

    expect(indices).toEqual([0, 1, 2]);
    expect(tree.leafCount).toBe(3);
  });

  it("should produce the same root as individual inserts", () => {
    const leaves = ["p", "q", "r", "s"].map(sha256);

    const tree1 = new MerkleTree();
    tree1.insertBatch(leaves);

    const tree2 = new MerkleTree();
    for (const leaf of leaves) {
      tree2.insert(leaf);
    }

    expect(tree1.root).toBe(tree2.root);
  });

  it("should continue indexing after a batch", () => {
    const tree = new MerkleTree();
    tree.insertBatch(["a", "b"].map(sha256));

    const idx = tree.insert(sha256("c"));
    expect(idx).toBe(2);
  });
});

// ============================================================
// Leaf Access
// ============================================================

describe("MerkleTree — Leaf Access", () => {
  it("should return a leaf by index", () => {
    const tree = new MerkleTree();
    const leaf = sha256("my-leaf");
    tree.insert(leaf);

    expect(tree.getLeaf(0)).toBe(leaf);
  });

  it("should return undefined for out-of-range index", () => {
    const tree = new MerkleTree();
    expect(tree.getLeaf(0)).toBeUndefined();
  });

  it("should return all leaves", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b", "c"].map(sha256);
    tree.insertBatch(leaves);

    expect(tree.getLeaves()).toEqual(leaves);
  });

  it("should return a copy of leaves (not the internal array)", () => {
    const tree = new MerkleTree();
    tree.insert(sha256("a"));

    const copy = tree.getLeaves();
    copy.push(sha256("injected"));

    expect(tree.leafCount).toBe(1); // original unchanged
  });
});

// ============================================================
// merkleHash export
// ============================================================

describe("merkleHash utility", () => {
  it("should produce valid SHA-256 hex strings", () => {
    const hash = merkleHash("test-data");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should be deterministic", () => {
    expect(merkleHash("hello")).toBe(merkleHash("hello"));
  });

  it("should produce different hashes for different inputs", () => {
    expect(merkleHash("a")).not.toBe(merkleHash("b"));
  });
});

# VoxPop — REST API Design

## Base URL

```
Production:  https://api.voxpop-app.com/v1
Development: http://localhost:3001/v1
```

## Authentication

All authenticated endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

Tokens are issued after identity verification and expire after 24 hours.

## Endpoints

### Identity & Authentication

#### `POST /auth/verify/eidas`
Start eIDAS identity verification flow.

**Request:**
```json
{
  "country": "FR",
  "provider": "franceconnect",
  "callback_url": "https://app.voxpop-app.com/verify/callback"
}
```

**Response (200):**
```json
{
  "redirect_url": "https://franceconnect.gouv.fr/authorize?...",
  "session_id": "sess_abc123"
}
```

#### `POST /auth/verify/document`
Start document-based verification.

**Request:** `multipart/form-data`
- `document_image` — Photo of passport/ID
- `country` — ISO 3166-1 alpha-2 country code

**Response (200):**
```json
{
  "session_id": "sess_def456",
  "next_step": "liveness_check"
}
```

#### `POST /auth/verify/callback`
Complete verification and receive cryptographic identity.

**Response (200):**
```json
{
  "verified": true,
  "country": "FR",
  "commitment": "0x1a2b3c...",
  "merkle_tree_root": "0x4d5e6f...",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Polls (Vote Creation)

#### `GET /polls`
List active polls.

**Query Parameters:**
- `country` — Filter by country (ISO 3166-1)
- `status` — `active`, `closed`, `upcoming`
- `page` — Page number (default: 1)
- `limit` — Results per page (default: 20, max: 100)

**Response (200):**
```json
{
  "polls": [
    {
      "id": "poll_789",
      "title": "Should we invest in renewable energy?",
      "description": "...",
      "options": ["Yes", "No", "Abstain"],
      "country": "FR",
      "status": "active",
      "created_at": "2026-03-01T10:00:00Z",
      "closes_at": "2026-03-31T23:59:59Z",
      "total_votes": 12450,
      "merkle_tree_root": "0x4d5e6f..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

#### `POST /polls`
Create a new poll. Requires authentication.

**Request:**
```json
{
  "title": "Should we invest in renewable energy?",
  "description": "Vote on the municipal energy plan for 2026-2030.",
  "options": ["Yes", "No", "Abstain"],
  "country": "FR",
  "closes_at": "2026-03-31T23:59:59Z",
  "settings": {
    "anonymous": true,
    "require_zkp": true,
    "allow_delegation": false
  }
}
```

**Response (201):**
```json
{
  "id": "poll_789",
  "status": "active",
  "created_at": "2026-03-01T10:00:00Z"
}
```

#### `GET /polls/:id`
Get poll details including current results (if closed or configured to show live).

### Voting

#### `POST /polls/:id/vote`
Cast a vote with ZKP.

**Request:**
```json
{
  "proof": {
    "pi_a": ["0x...", "0x..."],
    "pi_b": [["0x...", "0x..."], ["0x...", "0x..."]],
    "pi_c": ["0x...", "0x..."],
    "protocol": "groth16"
  },
  "nullifier_hash": "0x9c2f1b8a...",
  "merkle_tree_root": "0x4d5e6f...",
  "encrypted_vote": "0xabc123...",
  "signal": "0xdef456..."
}
```

**Response (200):**
```json
{
  "accepted": true,
  "receipt": {
    "vote_hash": "0xa3f9d7e2...",
    "nullifier": "0x9c2f1b8a...",
    "chain_position": 12451,
    "previous_hash": "0xb2e4f8c1...",
    "timestamp": "2026-03-15T14:30:00Z"
  }
}
```

**Error (409 — Already Voted):**
```json
{
  "error": "ALREADY_VOTED",
  "message": "A vote with this nullifier has already been recorded."
}
```

**Error (400 — Invalid Proof):**
```json
{
  "error": "INVALID_PROOF",
  "message": "The ZK-SNARK proof could not be verified."
}
```

### Verification & Audit

#### `GET /polls/:id/results`
Get poll results with hash chain verification data.

**Response (200):**
```json
{
  "poll_id": "poll_789",
  "status": "closed",
  "results": [
    { "option": "Yes", "votes": 8340, "percentage": 67.4 },
    { "option": "No", "votes": 3440, "percentage": 27.8 },
    { "option": "Abstain", "votes": 594, "percentage": 4.8 }
  ],
  "total_votes": 12374,
  "hash_chain": {
    "genesis_hash": "0x000...",
    "final_hash": "0xfff...",
    "length": 12374
  },
  "merkle_tree_root": "0x4d5e6f...",
  "closed_at": "2026-03-31T23:59:59Z"
}
```

#### `GET /polls/:id/verify/:vote_hash`
Verify a specific vote exists in the hash chain.

**Response (200):**
```json
{
  "verified": true,
  "position": 12451,
  "vote_hash": "0xa3f9d7e2...",
  "previous_hash": "0xb2e4f8c1...",
  "next_hash": "0xc3d5e6f7...",
  "timestamp": "2026-03-15T14:30:00Z"
}
```

#### `GET /polls/:id/audit`
Get full audit trail for a poll.

**Response (200):**
```json
{
  "poll_id": "poll_789",
  "audit": {
    "total_proofs_verified": 12374,
    "invalid_proofs_rejected": 23,
    "duplicate_nullifiers_rejected": 7,
    "hash_chain_valid": true,
    "merkle_tree_consistent": true
  }
}
```

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /auth/verify/*` | 5 requests | 15 minutes |
| `POST /polls` | 10 requests | 1 hour |
| `POST /polls/:id/vote` | 3 requests | 1 minute |
| `GET /polls/*` | 100 requests | 1 minute |
| `GET /*/verify/*` | 50 requests | 1 minute |

Rate limit headers included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1709312400
```

## Error Format

All errors follow a consistent format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| `INVALID_PROOF` | 400 | ZKP verification failed |
| `ALREADY_VOTED` | 409 | Nullifier already exists |
| `POLL_CLOSED` | 410 | Poll is no longer accepting votes |
| `POLL_NOT_FOUND` | 404 | Poll does not exist |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `RATE_LIMITED` | 429 | Too many requests |
| `WRONG_COUNTRY` | 403 | Voter not in required Merkle Tree |
| `INVALID_NULLIFIER` | 400 | Nullifier format invalid |

## CORS

```
Access-Control-Allow-Origin: https://app.voxpop-app.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

## Versioning

API versioned via URL path (`/v1/`). Breaking changes require a new version. Non-breaking additions (new fields, new endpoints) are added to the current version.

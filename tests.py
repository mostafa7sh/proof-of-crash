import requests

# Test for: As a developer, I want to upload my application
def test_app_upload():
    files = {'file': ('test_app.exe', b'binary_data')}
    response = requests.post("http://proof-of-crash.com/api/upload", files=files)
    assert response.status_code == 201
    assert "upload_id" in response.json()

test_app_upload()


# Test for: As a tester, I want to upload a specific crash input as proof
def test_submit_crash_proof():
    payload = {
        "app_id": "12345",
        "crash_input": "0xFF88A2",
        "tester_id": "tester_01"
    }
    response = requests.post("http://proof-of-crash.com/api/submit-proof", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "pending_verification"

test_submit_crash_proof()

# Test for: As a verifier, I want to submit my digital signature to confirm validity
def test_peer_verification():
    payload = {
        "proof_id": "POC-99",
        "verifier_id": "peer_42",
        "signature": "sig_x7b8",
        "vote": "valid"
    }
    response = requests.post("http://proof-of-crash.com/api/verify", json=payload)
    assert response.status_code == 200
    assert "consensus_reached" in response.json()

test_peer_verification()

# Test for: As a contributor, I want the system to generate a "Block of Crash"
def test_block_creation():
    response = requests.get("http://proof-of-crash.com/api/ledger/latest")
    block_data = response.json()
    assert "block_hash" in block_data
    assert "verified_crash_data" in block_data
    assert response.status_code == 200

test_block_creation()
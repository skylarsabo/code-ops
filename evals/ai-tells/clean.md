Add retry logic to the uploader

Exponential backoff on the S3 uploader so transient 5xx don't fail the whole job.
The cap is 30s with jitter — keeps us from hammering a bad endpoint.

Note: ties to the incident tracked under ref 550e8400-e29b-41d4-a716-446655440000.

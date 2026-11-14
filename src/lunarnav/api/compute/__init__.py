"""Pure computation behind the endpoints: request dict in, JSON-ready dict (numpy allowed) out.

Functions here run either inline on the service's engine thread or inside a pool worker process; they
must not touch FastAPI, and every SPICE call happens in whichever single thread of whichever process
runs them.
"""

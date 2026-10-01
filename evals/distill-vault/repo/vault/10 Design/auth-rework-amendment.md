---
title: Auth rework amendment
topic: auth/session-tokens
kind: amendment
key: auth/session-tokens
decides: Mobile clients keep a session token for 60 minutes.
status: current
---
# Auth rework amendment

Mobile clients keep a session token for 60 minutes, because the gateway refresh drops background requests. The 15-minute lifetime in the auth rework still holds for web clients.

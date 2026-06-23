# Tiny Server

A minimal HTTP server you embed in a Node process; call `shutdown()` to stop it.

## Configuration

The default port is 3000.

Pass `{ port }` to override it.

## API

`start(options)` returns a Promise that resolves once the server is listening.



`connect(url)` opens a client connection to a running server.

## Roadmap

Planned but not yet implemented: TLS/HTTPS support and a pluggable logger.

## Environment

`DEFAULT_PORT` is exported so tests import the same constant the server uses.

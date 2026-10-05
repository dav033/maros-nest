# Maros API deployment

A push to `main` starts `.github/workflows/deploy.yml`. GitHub sends the exact commit SHA to the VPS over SSH. The SSH key is restricted to one forced deployment command, with forwarding and interactive access disabled. The VPS fetches the public `dav033/maros-nest` repository, verifies that the commit is on `main`, builds the Docker image, and replaces only the `api` service in `/opt/stack-api/compose.yml`.

The deployment checks `GET /api` inside the container. If the new image does not start or return HTTP 200 within two minutes, the VPS restores the previous image tag and restarts the prior container. PostgreSQL, Garage object storage, Caddy, and other projects are not part of this deployment.

Repository Actions configuration:

- Secret `MAROS_DEPLOY_KEY`: dedicated Ed25519 key for the restricted SSH account.
- Variable `MAROS_DEPLOY_HOST`: the VPS address.
- Variable `MAROS_DEPLOY_KNOWN_HOSTS`: pinned OpenSSH host key for that address.

The Docker build context excludes environment files, Git history, dependencies, and generated output. Database schema changes still require an explicit migration plan; this pipeline does not run schema migrations automatically.

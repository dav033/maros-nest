#!/usr/bin/env bash
set -Eeuo pipefail

commit="${1:?expected commit SHA}"
source_dir="${2:?expected checked-out source directory}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$commit" ]]
[[ -f "$source_dir/Dockerfile" ]]

exec 9>/run/lock/maros-nest-deploy.lock
flock -n 9 || { echo "DEPLOY_BUSY"; exit 75; }

compose=(docker compose -f /opt/stack-api/compose.yml)
old_image=0
if docker image inspect maros-stack-api:current >/dev/null 2>&1; then
  docker tag maros-stack-api:current maros-stack-api:previous
  old_image=1
fi

rollback() {
  if [[ "$old_image" -eq 1 ]] && docker image inspect maros-stack-api:previous >/dev/null 2>&1; then
    docker tag maros-stack-api:previous maros-stack-api:current
    "${compose[@]}" up -d --no-deps --no-build api >/dev/null || true
    echo "DEPLOY_ROLLED_BACK commit=$commit"
  else
    echo "DEPLOY_FAILED_WITHOUT_PREVIOUS_IMAGE commit=$commit"
  fi
}

if ! docker build --pull --tag maros-stack-api:current --file "$source_dir/Dockerfile" "$source_dir"; then
  echo "DEPLOY_BUILD_FAILED commit=$commit"
  exit 1
fi

if ! "${compose[@]}" up -d --no-deps --no-build api; then
  rollback
  exit 1
fi

for attempt in $(seq 1 30); do
  if docker exec maros-stack-api node -e 'fetch("http://127.0.0.1:3000/api").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    echo "DEPLOY_OK commit=$commit health=200"
    exit 0
  fi
  sleep 4
done

rollback
exit 1

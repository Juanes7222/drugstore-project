# Production operations wrapper around scripts/deploy.sh and docker compose.
# Requires GNU make (Linux server). Windows dev machines use compose directly.

S      ?= server
COMPOSE := docker compose -f docker-compose.prod.yml

.PHONY: init deploy migrate status logs backup-db renew-certs shell down

init:
	./scripts/deploy.sh init

deploy:
	./scripts/deploy.sh deploy

migrate:
	./scripts/deploy.sh migrate

status:
	./scripts/deploy.sh status

logs:
	$(COMPOSE) logs -f --tail 100 $(S)

backup-db:
	./scripts/deploy.sh backup-db

renew-certs:
	./scripts/deploy.sh renew-certs

shell:
	$(COMPOSE) exec $(S) sh

down:
	$(COMPOSE) down

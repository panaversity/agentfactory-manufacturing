#!/usr/bin/env bash
# Deploy Maya's harness to Azure Container Apps.
# Builds the image in the cloud (ACR Tasks), then creates the app with
# external ingress and scale-to-zero. Secrets are stored by name, not baked
# into the image or revision.
#
# Prereqs: az CLI logged in (az login) and the containerapp extension
#   az extension add --name containerapp
#
# Fill these in or pass them as environment variables before running.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-maya-rg}"
LOCATION="${LOCATION:-eastus}"
ENVIRONMENT="${ENVIRONMENT:-maya-env}"
ACR_NAME="${ACR_NAME:-mayaacr$RANDOM}"   # 5-50 lowercase alphanumeric, globally unique
APP_NAME="${APP_NAME:-maya-harness}"
IMAGE_TAG="${IMAGE_TAG:-maya-harness:latest}"

# Secrets the app needs at runtime. Set these in your shell first.
OPENAI_API_KEY="${OPENAI_API_KEY:?set OPENAI_API_KEY}"
DATABASE_URL="${DATABASE_URL:-}"

echo "==> Resource group"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

echo "==> Container registry"
az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic --admin-enabled true

echo "==> Build image in the cloud (no local Docker needed)"
az acr build --registry "$ACR_NAME" --image "$IMAGE_TAG" .

echo "==> Container Apps environment"
az containerapp env create --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION"

echo "==> Create the app (external ingress, scale to zero)"
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT" \
  --image "$ACR_NAME.azurecr.io/$IMAGE_TAG" \
  --registry-server "$ACR_NAME.azurecr.io" \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3 \
  --secrets "openai-api-key=$OPENAI_API_KEY" "database-url=$DATABASE_URL" \
  --env-vars "OPENAI_API_KEY=secretref:openai-api-key" "DATABASE_URL=secretref:database-url"

echo "==> Done. Public URL:"
az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" --output tsv

# Teardown when you are finished:
#   az group delete --name "$RESOURCE_GROUP" --yes

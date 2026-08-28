# kubernetes

Kubernetes manifests for sector command / HA deployment.

Apply order for a small pilot namespace:

```bash
kubectl apply -f deploy/kubernetes/postgres.yaml
kubectl apply -f deploy/kubernetes/control-api.yaml
kubectl apply -f deploy/kubernetes/edge-bridge.yaml
```

Before production use, replace all Secret values, build and push immutable images instead of `latest`, and place `vigilai-control-api` behind the site TLS/mTLS gateway. Run migrations before switching traffic:

```bash
kubectl run vigilai-migrate --rm -i --restart=Never --image=vigilai/control-api:latest -- npm run db:migrate
```

# K3s Cluster Configuration Guide

## Network Configuration

### Subnet Configuration
- **Private Network Range**: 10.0.0.0/8 (All internal IPs)
- **K3s Installation Subnet**: 10.0.0.0/9 (10.0.0.0 to 10.127.255.255)
- **Jump Host**: 10.128.0.1 (Outside the K3s subnet but within the private network)

### Firewall Rules
The firewall is configured to allow traffic from the entire private network range (10.0.0.0/8) to ensure all nodes can communicate, including the jump host which is outside the K3s subnet.

```bash
ufw allow ssh
ufw allow from 10.0.0.0/8
```

## Script Roles

### setup-k3s-cluster.js
This script prepares the local environment for deployment:
- Creates necessary directories (manifests, scripts, configs, certs)
- Generates SSH keys for node communication
- Creates installation scripts for different node types
- Generates Kubernetes manifest files
- Does NOT actually deploy anything to remote servers

### deploy-k3s-cluster.js
This script performs the actual deployment:
- Configures the jump host as a gateway
- Deploys K3s to all nodes in the correct order
- Copies and applies Kubernetes manifests
- Sets up node labels and taints
- Retrieves the kubeconfig file

## K3s Installation Parameters

To restrict K3s to the 10.0.0.0/9 subnet, the following parameters are used in the K3s installation:

```bash
# For master nodes
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-cidr=10.0.0.0/9 \
  --service-cidr=10.96.0.0/12 \
  ...

# For worker nodes
curl -sfL https://get.k3s.io | sh -s - agent \
  ...
```

The `--cluster-cidr` parameter restricts the pod network to the specified subnet.

## Node Types and Roles

1. **Manager Nodes** (10.0.1.x):
   - Run the K3s server component
   - Form the control plane
   - First manager initializes the cluster
   - Additional managers join the existing cluster

2. **Worker Nodes** (10.0.2.x):
   - Run the K3s agent component
   - Execute general workloads

3. **Database Nodes** (10.0.3.x):
   - Specialized worker nodes
   - Tainted to only run database workloads
   - Higher resource allocation (8GB RAM, 4 vCPU)

4. **Messaging Nodes** (10.0.4.x):
   - Specialized worker nodes
   - Tainted to only run messaging workloads

5. **Jump Host** (10.128.0.1):
   - Gateway to the cluster
   - Provides NAT for outbound traffic
   - Only node with public IP

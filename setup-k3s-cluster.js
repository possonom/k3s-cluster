#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  network: {
    privateSubnet: '10.0.0.0/9',
    jumpHost: {
      ip: '10.128.0.1',
    }
  },
  nodes: {
    managers: [
      { name: 'manager-1', ip: '10.0.1.1', ram: 4, cpu: 2 },
      { name: 'manager-2', ip: '10.0.1.2', ram: 4, cpu: 2 },
      { name: 'manager-3', ip: '10.0.1.3', ram: 4, cpu: 2 },
    ],
    workers: [
      { name: 'worker-1', ip: '10.0.2.1', ram: 4, cpu: 2 },
      { name: 'worker-2', ip: '10.0.2.2', ram: 4, cpu: 2 },
    ],
    database: [
      { name: 'db-1', ip: '10.0.3.1', ram: 8, cpu: 4 },
      { name: 'db-2', ip: '10.0.3.2', ram: 8, cpu: 4 },
    ],
    messaging: [
      { name: 'msg-1', ip: '10.0.4.1', ram: 4, cpu: 2 },
      { name: 'msg-2', ip: '10.0.4.2', ram: 4, cpu: 2 },
    ]
  },
  storage: {
    storageBox: {
      nfsServer: 'your-storage-box.your-storagebox.de',
      nfsPath: '/your-storage-box',
      size: '1TB'
    },
    objectStorage: {
      endpoint: 's3.hetzner.cloud',
      region: 'eu-central-1',
      bucketName: 'k3s-cluster-backup'
    }
  },
  k3s: {
    version: 'v1.25.6+k3s1',
    token: 'your-secure-k3s-token'
  }
};

// Create directory structure
console.log('Creating directory structure...');
const dirs = [
  'manifests',
  'scripts',
  'configs',
  'certs'
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Generate SSH key for cluster communication
console.log('Generating SSH key for cluster communication...');
if (!fs.existsSync('certs/id_rsa')) {
  execSync('ssh-keygen -t rsa -b 4096 -f certs/id_rsa -N ""');
}

// Create scripts for node setup
console.log('Creating node setup scripts...');

// Base node setup script
fs.writeFileSync('scripts/base-node-setup.sh', `#!/bin/bash
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install dependencies
apt-get install -y curl wget vim htop iptables nfs-common

# Set up firewall
ufw allow ssh
ufw allow from 10.0.0.0/9
ufw --force enable

# Configure sysctl for Kubernetes
cat > /etc/sysctl.d/k8s.conf << EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF

sysctl --system

# Disable swap
swapoff -a
sed -i '/swap/d' /etc/fstab

# Set hostname
hostnamectl set-hostname \${HOSTNAME}

# Add hosts entries
cat >> /etc/hosts << EOF
10.0.1.1 manager-1
10.0.1.2 manager-2
10.0.1.3 manager-3
10.0.2.1 worker-1
10.0.2.2 worker-2
10.0.3.1 db-1
10.0.3.2 db-2
10.0.4.1 msg-1
10.0.4.2 msg-2
10.128.0.1 jump-host
EOF

# Set up routing through jump host
ip route add default via 10.128.0.1
`);

// K3s master node setup script
fs.writeFileSync('scripts/setup-master.sh', `#!/bin/bash
set -e

# Install K3s server
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" sh -s - server \\
  --token=${config.k3s.token} \\
  --tls-san=\${NODE_IP} \\
  --node-ip=\${NODE_IP} \\
  --advertise-address=\${NODE_IP} \\
  --flannel-iface=eth1 \\
  --disable=traefik \\
  --disable=servicelb \\
  --cluster-init

# Wait for K3s to be ready
sleep 10

# Copy kubeconfig for easier access
mkdir -p /home/ubuntu/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
sed -i "s/127.0.0.1/\${NODE_IP}/g" /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
`);

// K3s additional master nodes setup script
fs.writeFileSync('scripts/setup-additional-master.sh', `#!/bin/bash
set -e

# Install K3s server
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" sh -s - server \\
  --token=${config.k3s.token} \\
  --tls-san=\${NODE_IP} \\
  --node-ip=\${NODE_IP} \\
  --advertise-address=\${NODE_IP} \\
  --flannel-iface=eth1 \\
  --disable=traefik \\
  --disable=servicelb \\
  --server https://10.0.1.1:6443

# Wait for K3s to be ready
sleep 10

# Copy kubeconfig for easier access
mkdir -p /home/ubuntu/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
sed -i "s/127.0.0.1/\${NODE_IP}/g" /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
`);

// K3s worker node setup script
fs.writeFileSync('scripts/setup-worker.sh', `#!/bin/bash
set -e

# Install K3s agent
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" K3S_URL=https://10.0.1.1:6443 K3S_TOKEN=${config.k3s.token} sh -s - agent \\
  --node-ip=\${NODE_IP} \\
  --flannel-iface=eth1
`);

// Create Kubernetes manifests
console.log('Creating Kubernetes manifests...');

// Longhorn storage class
fs.writeFileSync('manifests/longhorn.yaml', `apiVersion: v1
kind: Namespace
metadata:
  name: longhorn-system
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: longhorn
  namespace: kube-system
spec:
  chart: longhorn
  repo: https://charts.longhorn.io
  targetNamespace: longhorn-system
  valuesContent: |-
    defaultSettings:
      defaultReplicaCount: 3
      createDefaultDiskLabeledNodes: true
    persistence:
      defaultClassReplicaCount: 3
    ingress:
      enabled: false
`);

// Hetzner CSI driver
fs.writeFileSync('manifests/hetzner-csi.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: hcloud-csi
  namespace: kube-system
stringData:
  token: "your-hetzner-api-token"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: hcloud-csi
  namespace: kube-system
spec:
  chart: hcloud-csi
  repo: https://charts.hetzner.cloud
  targetNamespace: kube-system
  valuesContent: |-
    controller:
      enabled: true
    node:
      enabled: true
    secret:
      existingSecret: hcloud-csi
`);

// NFS provisioner for Hetzner Storage Box
fs.writeFileSync('manifests/nfs-provisioner.yaml', `apiVersion: v1
kind: Namespace
metadata:
  name: nfs-provisioner
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: nfs-subdir-external-provisioner
  namespace: kube-system
spec:
  chart: nfs-subdir-external-provisioner
  repo: https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
  targetNamespace: nfs-provisioner
  valuesContent: |-
    nfs:
      server: ${config.storage.storageBox.nfsServer}
      path: ${config.storage.storageBox.nfsPath}
    storageClass:
      name: nfs-storageclass
      defaultClass: false
      reclaimPolicy: Retain
`);

// Hetzner Load Balancer Controller
fs.writeFileSync('manifests/hetzner-lb-controller.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: hcloud-lb
  namespace: kube-system
stringData:
  token: "your-hetzner-api-token"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: hcloud-cloud-controller-manager
  namespace: kube-system
spec:
  chart: hcloud-cloud-controller-manager
  repo: https://charts.hetzner.cloud
  targetNamespace: kube-system
  valuesContent: |-
    networking:
      enabled: true
      networkID: "your-hetzner-network-id"
    secret:
      existingSecret: hcloud-lb
`);

// S3 backup configuration
fs.writeFileSync('manifests/s3-backup.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: s3-backup-credentials
  namespace: kube-system
stringData:
  accessKey: "your-access-key"
  secretKey: "your-secret-key"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: velero
  namespace: kube-system
spec:
  chart: velero
  repo: https://vmware-tanzu.github.io/helm-charts
  targetNamespace: velero
  valuesContent: |-
    configuration:
      provider: aws
      backupStorageLocation:
        name: default
        bucket: ${config.storage.objectStorage.bucketName}
        config:
          region: ${config.storage.objectStorage.region}
          s3ForcePathStyle: true
          s3Url: https://${config.storage.objectStorage.endpoint}
      volumeSnapshotLocation:
        name: default
        config:
          region: ${config.storage.objectStorage.region}
    credentials:
      existingSecret: s3-backup-credentials
    initContainers:
      - name: velero-plugin-for-aws
        image: velero/velero-plugin-for-aws:v1.5.0
        volumeMounts:
          - mountPath: /target
            name: plugins
`);

// Node labels and taints
fs.writeFileSync('manifests/node-labels.yaml', `apiVersion: v1
kind: ConfigMap
metadata:
  name: node-labels
  namespace: kube-system
data:
  apply-labels.sh: |
    #!/bin/bash
    
    # Label and taint database nodes
    kubectl label nodes db-1 db-2 node-role.kubernetes.io/database=true
    kubectl taint nodes db-1 db-2 dedicated=database:NoSchedule
    
    # Label and taint messaging nodes
    kubectl label nodes msg-1 msg-2 node-role.kubernetes.io/messaging=true
    kubectl taint nodes msg-1 msg-2 dedicated=messaging:NoSchedule
    
    # Label worker nodes
    kubectl label nodes worker-1 worker-2 node-role.kubernetes.io/worker=true
`);

// Create main deployment script
console.log('Creating main deployment script...');
fs.writeFileSync('deploy-k3s-cluster.js', `#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration is loaded from the setup script
const config = require('./setup-k3s-cluster').config;

// Function to run commands on remote nodes via SSH
function runOnNode(nodeIp, command) {
  console.log(\`Running on \${nodeIp}: \${command}\`);
  try {
    execSync(\`ssh -i certs/id_rsa -o StrictHostKeyChecking=no ubuntu@\${nodeIp} '\${command}'\`, 
      { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(\`Error on \${nodeIp}: \${error.message}\`);
    return false;
  }
}

// Function to copy files to remote nodes
function copyToNode(nodeIp, localPath, remotePath) {
  console.log(\`Copying \${localPath} to \${nodeIp}:\${remotePath}\`);
  try {
    execSync(\`scp -i certs/id_rsa -o StrictHostKeyChecking=no \${localPath} ubuntu@\${nodeIp}:\${remotePath}\`,
      { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(\`Error copying to \${nodeIp}: \${error.message}\`);
    return false;
  }
}

// Deploy the cluster
async function deployCluster() {
  console.log('Starting K3s cluster deployment...');
  
  // Setup jump host as gateway
  console.log('Setting up jump host as gateway...');
  runOnNode(config.network.jumpHost.ip, \`
    sudo sysctl -w net.ipv4.ip_forward=1
    echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
    sudo iptables -t nat -A POSTROUTING -s \${config.network.privateSubnet} -o eth0 -j MASQUERADE
    sudo apt-get update && sudo apt-get install -y iptables-persistent
    sudo netfilter-persistent save
  \`);
  
  // Setup first master node
  console.log('Setting up first master node...');
  copyToNode(config.nodes.managers[0].ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
  runOnNode(config.nodes.managers[0].ip, 'chmod +x /tmp/base-node-setup.sh && HOSTNAME=manager-1 sudo -E /tmp/base-node-setup.sh');
  
  copyToNode(config.nodes.managers[0].ip, 'scripts/setup-master.sh', '/tmp/setup-master.sh');
  runOnNode(config.nodes.managers[0].ip, \`chmod +x /tmp/setup-master.sh && NODE_IP=\${config.nodes.managers[0].ip} sudo -E /tmp/setup-master.sh\`);
  
  // Get kubeconfig from first master
  console.log('Retrieving kubeconfig...');
  execSync(\`scp -i certs/id_rsa -o StrictHostKeyChecking=no ubuntu@\${config.nodes.managers[0].ip}:/etc/rancher/k3s/k3s.yaml ./configs/kubeconfig.yaml\`);
  execSync(\`sed -i "s/127.0.0.1/\${config.nodes.managers[0].ip}/g" ./configs/kubeconfig.yaml\`);
  
  // Setup additional master nodes
  console.log('Setting up additional master nodes...');
  for (let i = 1; i < config.nodes.managers.length; i++) {
    const node = config.nodes.managers[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, \`chmod +x /tmp/base-node-setup.sh && HOSTNAME=manager-\${i+1} sudo -E /tmp/base-node-setup.sh\`);
    
    copyToNode(node.ip, 'scripts/setup-additional-master.sh', '/tmp/setup-additional-master.sh');
    runOnNode(node.ip, \`chmod +x /tmp/setup-additional-master.sh && NODE_IP=\${node.ip} sudo -E /tmp/setup-additional-master.sh\`);
  }
  
  // Setup worker nodes
  console.log('Setting up worker nodes...');
  for (let i = 0; i < config.nodes.workers.length; i++) {
    const node = config.nodes.workers[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, \`chmod +x /tmp/base-node-setup.sh && HOSTNAME=worker-\${i+1} sudo -E /tmp/base-node-setup.sh\`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, \`chmod +x /tmp/setup-worker.sh && NODE_IP=\${node.ip} sudo -E /tmp/setup-worker.sh\`);
  }
  
  // Setup database nodes
  console.log('Setting up database nodes...');
  for (let i = 0; i < config.nodes.database.length; i++) {
    const node = config.nodes.database[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, \`chmod +x /tmp/base-node-setup.sh && HOSTNAME=db-\${i+1} sudo -E /tmp/base-node-setup.sh\`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, \`chmod +x /tmp/setup-worker.sh && NODE_IP=\${node.ip} sudo -E /tmp/setup-worker.sh\`);
  }
  
  // Setup messaging nodes
  console.log('Setting up messaging nodes...');
  for (let i = 0; i < config.nodes.messaging.length; i++) {
    const node = config.nodes.messaging[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, \`chmod +x /tmp/base-node-setup.sh && HOSTNAME=msg-\${i+1} sudo -E /tmp/base-node-setup.sh\`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, \`chmod +x /tmp/setup-worker.sh && NODE_IP=\${node.ip} sudo -E /tmp/setup-worker.sh\`);
  }
  
  // Deploy Kubernetes manifests
  console.log('Deploying Kubernetes manifests...');
  
  // Copy manifests to first master
  for (const manifest of fs.readdirSync('manifests')) {
    copyToNode(config.nodes.managers[0].ip, \`manifests/\${manifest}\`, \`/tmp/\${manifest}\`);
  }
  
  // Apply manifests
  runOnNode(config.nodes.managers[0].ip, 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && ' + 
    fs.readdirSync('manifests').map(m => \`kubectl apply -f /tmp/\${m}\`).join(' && '));
  
  // Apply node labels and taints
  runOnNode(config.nodes.managers[0].ip, 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && ' +
    'kubectl create -f /tmp/node-labels.yaml && ' +
    'chmod +x /tmp/apply-labels.sh && /tmp/apply-labels.sh');
  
  console.log('K3s cluster deployment completed successfully!');
  console.log('You can access the cluster using the kubeconfig file at ./configs/kubeconfig.yaml');
}

// Run the deployment
deployCluster().catch(err => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
`);

// Create README with instructions
console.log('Creating README...');
fs.writeFileSync('README.md', `# Hetzner K3s Cluster Setup

This repository contains scripts to set up a highly-available K3s cluster on Hetzner Cloud using ARM-based instances.

## Cluster Architecture

- 3 manager nodes (4GB RAM, 2 vCPU each) running the K3s control plane
- 2 worker nodes (4GB RAM, 2 vCPU each) for application workloads
- 2 database nodes (8GB RAM, 4 vCPU each)
- 2 messaging nodes (4GB RAM, 2 vCPU each)
- 1 jump host (4GB RAM, 2 vCPU) for public SSH connection

## Storage Configuration

- Longhorn for database data
- Hetzner Storage Box (1TB NFS) for shared persistent storage
- Hetzner Object Storage (S3-compatible) for backups and static assets

## Network Architecture

- Private network (10.0.0.0/8) for internal communication
- Jump host as internet gateway (10.128.0.1)
- Hetzner Load Balancer as the public entry point
- K3s installed in 10.0.0.0/9 subnet
- No public IPs for cluster nodes (except jump host)

## Prerequisites

Before running the deployment script, make sure to:

1. Create all the required Hetzner Cloud instances with ARM architecture
2. Configure the private network (10.0.0.0/8)
3. Set up the jump host with public IP
4. Update the configuration in \`setup-k3s-cluster.js\` with your actual node IPs and Hetzner API tokens

## Deployment

1. Update the configuration in \`setup-k3s-cluster.js\` with your actual values
2. Make the scripts executable:
   \`\`\`
   chmod +x setup-k3s-cluster.js deploy-k3s-cluster.js
   \`\`\`
3. Run the deployment script:
   \`\`\`
   ./deploy-k3s-cluster.js
   \`\`\`

## Accessing the Cluster

After deployment, you can access the cluster using the kubeconfig file at \`./configs/kubeconfig.yaml\`:

\`\`\`
export KUBECONFIG=./configs/kubeconfig.yaml
kubectl get nodes
\`\`\`

## Components Installed

- K3s Kubernetes distribution
- Longhorn for distributed storage
- Hetzner CSI driver for volumes
- NFS provisioner for Hetzner Storage Box
- Hetzner Load Balancer Controller
- S3 backup configuration with Velero
`);

// Make scripts executable
console.log('Making scripts executable...');
fs.chmodSync('setup-k3s-cluster.js', '755');
fs.chmodSync('deploy-k3s-cluster.js', '755');

console.log('Setup completed successfully!');

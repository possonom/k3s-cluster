#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load configuration from external file
const { config } = require('./setup-k3s-cluster');

// Function to run commands on remote nodes via SSH
function runOnNode(nodeIp, command) {
  console.log(`Running on ${nodeIp}: ${command}`);
  try {
    execSync(`ssh -i certs/id_rsa -o StrictHostKeyChecking=no ubuntu@${nodeIp} '${command}'`, 
      { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`Error on ${nodeIp}: ${error.message}`);
    return false;
  }
}

// Function to copy files to remote nodes
function copyToNode(nodeIp, localPath, remotePath) {
  console.log(`Copying ${localPath} to ${nodeIp}:${remotePath}`);
  try {
    execSync(`scp -i certs/id_rsa -o StrictHostKeyChecking=no ${localPath} ubuntu@${nodeIp}:${remotePath}`,
      { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`Error copying to ${nodeIp}: ${error.message}`);
    return false;
  }
}

// Deploy the cluster
async function deployCluster() {
  console.log('Starting K3s cluster deployment...');
  
  // Setup jump host as gateway
  console.log('Setting up jump host as gateway...');
  runOnNode(config.network.jumpHost.ip, `
    sudo sysctl -w net.ipv4.ip_forward=1
    echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
    sudo iptables -t nat -A POSTROUTING -s ${config.network.privateSubnet} -o eth0 -j MASQUERADE
    sudo apt-get update && sudo apt-get install -y iptables-persistent
    sudo netfilter-persistent save
  `);
  
  // Setup first master node
  console.log('Setting up first master node...');
  copyToNode(config.nodes.managers[0].ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
  runOnNode(config.nodes.managers[0].ip, 'chmod +x /tmp/base-node-setup.sh && HOSTNAME=manager-1 sudo -E /tmp/base-node-setup.sh');
  
  copyToNode(config.nodes.managers[0].ip, 'scripts/setup-master.sh', '/tmp/setup-master.sh');
  runOnNode(config.nodes.managers[0].ip, `chmod +x /tmp/setup-master.sh && NODE_IP=${config.nodes.managers[0].ip} sudo -E /tmp/setup-master.sh`);
  
  // Get kubeconfig from first master
  console.log('Retrieving kubeconfig...');
  execSync(`scp -i certs/id_rsa -o StrictHostKeyChecking=no ubuntu@${config.nodes.managers[0].ip}:/etc/rancher/k3s/k3s.yaml ./configs/kubeconfig.yaml`);
  execSync(`sed -i "s/127.0.0.1/${config.nodes.managers[0].ip}/g" ./configs/kubeconfig.yaml`);
  
  // Setup additional master nodes
  console.log('Setting up additional master nodes...');
  for (let i = 1; i < config.nodes.managers.length; i++) {
    const node = config.nodes.managers[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, `chmod +x /tmp/base-node-setup.sh && HOSTNAME=manager-${i+1} sudo -E /tmp/base-node-setup.sh`);
    
    copyToNode(node.ip, 'scripts/setup-additional-master.sh', '/tmp/setup-additional-master.sh');
    runOnNode(node.ip, `chmod +x /tmp/setup-additional-master.sh && NODE_IP=${node.ip} sudo -E /tmp/setup-additional-master.sh`);
  }
  
  // Setup worker nodes
  console.log('Setting up worker nodes...');
  for (let i = 0; i < config.nodes.workers.length; i++) {
    const node = config.nodes.workers[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, `chmod +x /tmp/base-node-setup.sh && HOSTNAME=worker-${i+1} sudo -E /tmp/base-node-setup.sh`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, `chmod +x /tmp/setup-worker.sh && NODE_IP=${node.ip} sudo -E /tmp/setup-worker.sh`);
  }
  
  // Setup database nodes
  console.log('Setting up database nodes...');
  for (let i = 0; i < config.nodes.database.length; i++) {
    const node = config.nodes.database[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, `chmod +x /tmp/base-node-setup.sh && HOSTNAME=db-${i+1} sudo -E /tmp/base-node-setup.sh`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, `chmod +x /tmp/setup-worker.sh && NODE_IP=${node.ip} sudo -E /tmp/setup-worker.sh`);
  }
  
  // Setup messaging nodes
  console.log('Setting up messaging nodes...');
  for (let i = 0; i < config.nodes.messaging.length; i++) {
    const node = config.nodes.messaging[i];
    copyToNode(node.ip, 'scripts/base-node-setup.sh', '/tmp/base-node-setup.sh');
    runOnNode(node.ip, `chmod +x /tmp/base-node-setup.sh && HOSTNAME=msg-${i+1} sudo -E /tmp/base-node-setup.sh`);
    
    copyToNode(node.ip, 'scripts/setup-worker.sh', '/tmp/setup-worker.sh');
    runOnNode(node.ip, `chmod +x /tmp/setup-worker.sh && NODE_IP=${node.ip} sudo -E /tmp/setup-worker.sh`);
  }
  
  // Deploy Kubernetes manifests
  console.log('Deploying Kubernetes manifests...');
  
  // Copy manifests to first master
  for (const manifest of fs.readdirSync('manifests')) {
    copyToNode(config.nodes.managers[0].ip, `manifests/${manifest}`, `/tmp/${manifest}`);
  }
  
  // Apply manifests
  runOnNode(config.nodes.managers[0].ip, 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && ' + 
    fs.readdirSync('manifests').map(m => `kubectl apply -f /tmp/${m}`).join(' && '));
  
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

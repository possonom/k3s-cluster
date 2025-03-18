# K3s Cluster Configuration Guide

## Centralized Configuration

All configuration for the K3s cluster is now centralized in the `config.js` file. This makes it easier to update all settings in one place.

## Required Configuration Values

Open the `config.js` file and update the following sections:

### 1. Network Configuration
- No changes needed for private subnet and jump host IP unless your network differs from 10.0.0.0/9 and 10.128.0.1

### 2. Node IP Addresses
- Update the IP addresses for all nodes if they differ from the defaults:
  - Manager nodes (10.0.1.1, 10.0.1.2, 10.0.1.3)
  - Worker nodes (10.0.2.1, 10.0.2.2)
  - Database nodes (10.0.3.1, 10.0.3.2)
  - Messaging nodes (10.0.4.1, 10.0.4.2)

### 3. Storage Configuration
- Update the Hetzner Storage Box details:
  ```javascript
  storageBox: {
    nfsServer: 'your-storage-box.your-storagebox.de', // Replace with your actual Storage Box hostname
    nfsPath: '/your-storage-box',                     // Replace with your actual Storage Box path
    size: '1TB'                                       // Update with your actual storage size
  }
  ```

- Update the Object Storage details:
  ```javascript
  objectStorage: {
    endpoint: 's3.hetzner.cloud',                    // Usually stays the same
    region: 'eu-central-1',                          // Update if using a different region
    bucketName: 'k3s-cluster-backup',                // Replace with your actual bucket name
    accessKey: 'your-access-key',                    // Replace with your S3 access key
    secretKey: 'your-secret-key'                     // Replace with your S3 secret key
  }
  ```

### 4. K3s Configuration
- Update the K3s token:
  ```javascript
  k3s: {
    version: 'v1.25.6+k3s1',                         // Update if you want a different K3s version
    token: 'your-secure-k3s-token'                   // Replace with a secure random token
  }
  ```

### 5. Hetzner API Configuration
- Add your Hetzner API token and network ID:
  ```javascript
  hetzner: {
    apiToken: 'your-hetzner-api-token',              // Replace with your Hetzner API token
    networkId: 'your-hetzner-network-id'             // Replace with your Hetzner network ID
  }
  ```

## Deployment Process

1. Update all configuration values in `config.js`
2. Run the setup script to generate all necessary files:
   ```
   ./setup-k3s-cluster.js
   ```
3. Run the deployment script to deploy the cluster:
   ```
   ./deploy-k3s-cluster.js
   ```

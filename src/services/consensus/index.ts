/**
 * Consensus Module Exports
 * Smart wallet tracking and consensus signal detection
 */

// Repository
export {
  SmartWalletRepository,
  getSmartWalletRepository,
  type SmartWallet,
  type PositionSnapshot,
  type ConsensusSignal as RepoConsensusSignal,
} from './smart-wallet-repository';

// Detector
export {
  detectConsensus,
  calculateSide,
  isSignificantPosition,
  calculateConfidenceScore,
  getConfidenceLevel,
  type WalletPosition,
  type ConsensusSignal,
  type DetectorConfig,
} from './consensus-detector';

// Scanner
export {
  SmartWalletScanner,
  createSmartWalletScanner,
  getSmartWalletScanner,
  type ScannerConfig,
} from './smart-wallet-scanner';

// Notifications
export {
  formatConsensusNotification,
  formatConsensusDigest,
  formatScanStatus,
} from './consensus-notification';

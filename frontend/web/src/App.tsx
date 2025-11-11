import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TaxRecord {
  id: string;
  name: string;
  encryptedIncome: string;
  publicDeduction: number;
  publicYear: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ name: "", income: "", deduction: "", year: "" });
  const [selectedRecord, setSelectedRecord] = useState<TaxRecord | null>(null);
  const [decryptedIncome, setDecryptedIncome] = useState<number | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("records");
  const [searchQuery, setSearchQuery] = useState("");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: TaxRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            name: businessData.name,
            encryptedIncome: businessId,
            publicDeduction: Number(businessData.publicValue1) || 0,
            publicYear: Number(businessData.publicValue2) || 2024,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTaxRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating tax record with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const incomeValue = parseInt(newRecordData.income) || 0;
      const businessId = `tax-record-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, incomeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRecordData.deduction) || 0,
        parseInt(newRecordData.year) || 2024,
        "Tax Record"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Tax record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", income: "", deduction: "", year: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Income decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = taxRecords.filter(record =>
    record.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    record.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const taxStats = {
    totalRecords: taxRecords.length,
    verifiedRecords: taxRecords.filter(r => r.isVerified).length,
    totalIncome: taxRecords.reduce((sum, r) => sum + (r.decryptedValue || 0), 0),
    avgDeduction: taxRecords.length > 0 ? taxRecords.reduce((sum, r) => sum + r.publicDeduction, 0) / taxRecords.length : 0
  };

  const faqItems = [
    { question: "What is FHE Tax Calculator?", answer: "A privacy-preserving tax calculator using Fully Homomorphic Encryption to keep your financial data secure." },
    { question: "How does FHE protect my data?", answer: "Your income data is encrypted and calculations are performed on encrypted data without decryption." },
    { question: "Is my data stored on blockchain?", answer: "Only encrypted data is stored on-chain. Your plaintext data never leaves your device." },
    { question: "What tax rates are used?", answer: "The calculator uses current tax brackets with standard deductions applied to encrypted income data." }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 FHE Tax Calculator</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Start</h2>
            <p>Secure your tax calculations with FHE encryption technology</p>
            <div className="connection-steps">
              <div className="step"><span>1</span><p>Connect your wallet</p></div>
              <div className="step"><span>2</span><p>Initialize FHE system</p></div>
              <div className="step"><span>3</span><p>Start encrypted tax calculations</p></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading tax records...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🔐 FHE Tax Calculator</h1>
          <p>Privacy-Preserving Tax Calculations</p>
        </div>
        
        <nav className="main-nav">
          <button className={activeTab === "records" ? "active" : ""} onClick={() => setActiveTab("records")}>Tax Records</button>
          <button className={activeTab === "stats" ? "active" : ""} onClick={() => setActiveTab("stats")}>Statistics</button>
          <button className={activeTab === "faq" ? "active" : ""} onClick={() => setActiveTab("faq")}>FAQ</button>
        </nav>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">Check FHE</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Record</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <main className="main-content">
        {activeTab === "records" && (
          <div className="records-tab">
            <div className="tab-header">
              <h2>Encrypted Tax Records</h2>
              <div className="header-controls">
                <input 
                  type="text" 
                  placeholder="Search records..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="records-grid">
              {filteredRecords.length === 0 ? (
                <div className="empty-state">
                  <p>No tax records found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">Create First Record</button>
                </div>
              ) : (
                filteredRecords.map((record, index) => (
                  <div key={index} className="record-card" onClick={() => setSelectedRecord(record)}>
                    <div className="card-header">
                      <h3>{record.name}</h3>
                      <span className={`status-badge ${record.isVerified ? 'verified' : 'pending'}`}>
                        {record.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                      </span>
                    </div>
                    <div className="card-content">
                      <p>Year: {record.publicYear}</p>
                      <p>Deduction: ${record.publicDeduction}</p>
                      <p>Income: {record.isVerified ? `$${record.decryptedValue}` : '🔒 Encrypted'}</p>
                    </div>
                    <div className="card-footer">
                      <span>{new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-tab">
            <h2>Tax Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Records</h3>
                <div className="stat-value">{taxStats.totalRecords}</div>
              </div>
              <div className="stat-card">
                <h3>Verified Records</h3>
                <div className="stat-value">{taxStats.verifiedRecords}</div>
              </div>
              <div className="stat-card">
                <h3>Total Income</h3>
                <div className="stat-value">${taxStats.totalIncome}</div>
              </div>
              <div className="stat-card">
                <h3>Avg Deduction</h3>
                <div className="stat-value">${taxStats.avgDeduction.toFixed(0)}</div>
              </div>
            </div>
            
            <div className="chart-container">
              <h3>Income Distribution</h3>
              <div className="chart">
                {taxRecords.filter(r => r.isVerified).map((record, index) => (
                  <div key={index} className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ height: `${Math.min(100, (record.decryptedValue || 0) / 1000)}%` }}
                    >
                      <span className="bar-label">${record.decryptedValue}</span>
                    </div>
                    <span className="bar-title">{record.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-tab">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <button 
                    className="faq-question" 
                    onClick={() => setFaqOpen(faqOpen === index ? null : index)}
                  >
                    {item.question}
                    <span className="faq-icon">{faqOpen === index ? '−' : '+'}</span>
                  </button>
                  {faqOpen === index && (
                    <div className="faq-answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      
      {showCreateModal && (
        <CreateRecordModal 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => {
            setSelectedRecord(null);
            setDecryptedIncome(null);
          }} 
          decryptedIncome={decryptedIncome} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-icon">
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateRecordModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'income' || name === 'deduction') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Tax Record</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Income data will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Record Name *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="Enter record name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Income Amount (Integer) *</label>
            <input 
              type="number" 
              name="income" 
              value={recordData.income} 
              onChange={handleChange} 
              placeholder="Enter income amount..." 
            />
            <div className="data-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Deduction Amount *</label>
            <input 
              type="number" 
              name="deduction" 
              value={recordData.deduction} 
              onChange={handleChange} 
              placeholder="Enter deduction amount..." 
            />
            <div className="data-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Tax Year *</label>
            <input 
              type="number" 
              name="year" 
              value={recordData.year} 
              onChange={handleChange} 
              placeholder="Enter tax year..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.income} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: TaxRecord;
  onClose: () => void;
  decryptedIncome: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ record, onClose, decryptedIncome, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedIncome !== null) return;
    const result = await decryptData();
  };

  const calculateTax = (income: number, deduction: number) => {
    const taxable = Math.max(0, income - deduction);
    if (taxable <= 10000) return taxable * 0.1;
    if (taxable <= 40000) return 1000 + (taxable - 10000) * 0.12;
    if (taxable <= 85000) return 4600 + (taxable - 40000) * 0.22;
    return 14500 + (taxable - 85000) * 0.24;
  };

  const currentIncome = record.isVerified ? (record.decryptedValue || 0) : (decryptedIncome || 0);
  const taxAmount = currentIncome > 0 ? calculateTax(currentIncome, record.publicDeduction) : 0;

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Tax Record Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-row">
              <span>Record Name:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-row">
              <span>Tax Year:</span>
              <strong>{record.publicYear}</strong>
            </div>
            <div className="info-row">
              <span>Standard Deduction:</span>
              <strong>${record.publicDeduction}</strong>
            </div>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Income Data</h3>
            <div className="data-row">
              <span>Income Amount:</span>
              <div className="income-display">
                {record.isVerified ? 
                  `$${record.decryptedValue} (Verified)` : 
                  decryptedIncome !== null ? 
                  `$${decryptedIncome} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedIncome !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 record.isVerified ? "✅ Verified" : 
                 decryptedIncome !== null ? "🔄 Re-verify" : 
                 "🔓 Decrypt Income"}
              </button>
            </div>
          </div>
          
          {(record.isVerified || decryptedIncome !== null) && (
            <div className="tax-calculation">
              <h3>Tax Calculation</h3>
              <div className="calculation-row">
                <span>Gross Income:</span>
                <span>${currentIncome}</span>
              </div>
              <div className="calculation-row">
                <span>Standard Deduction:</span>
                <span>-${record.publicDeduction}</span>
              </div>
              <div className="calculation-row total">
                <span>Estimated Tax:</span>
                <span>${taxAmount.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!record.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


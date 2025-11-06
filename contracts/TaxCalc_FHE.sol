pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TaxCalc_FHE is ZamaEthereumConfig {
    struct TaxRecord {
        string recordId;                
        euint32 encryptedIncome;        
        uint256 publicTaxRate;          
        uint256 publicDeduction;        
        string recordType;              
        address creator;                
        uint256 timestamp;              
        uint32 decryptedTax;            
        bool isVerified;                
    }

    mapping(string => TaxRecord) public taxRecords;
    string[] public recordIds;

    event TaxRecordCreated(string indexed recordId, address indexed creator);
    event TaxDecryptionVerified(string indexed recordId, uint32 decryptedTax);

    constructor() ZamaEthereumConfig() {
    }

    function createTaxRecord(
        string calldata recordId,
        string calldata recordType,
        externalEuint32 encryptedIncome,
        bytes calldata inputProof,
        uint256 publicTaxRate,
        uint256 publicDeduction
    ) external {
        require(bytes(taxRecords[recordId].recordId).length == 0, "Tax record already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedIncome, inputProof)), "Invalid encrypted input");

        taxRecords[recordId] = TaxRecord({
            recordId: recordId,
            encryptedIncome: FHE.fromExternal(encryptedIncome, inputProof),
            publicTaxRate: publicTaxRate,
            publicDeduction: publicDeduction,
            recordType: recordType,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedTax: 0,
            isVerified: false
        });

        FHE.allowThis(taxRecords[recordId].encryptedIncome);
        FHE.makePubliclyDecryptable(taxRecords[recordId].encryptedIncome);

        recordIds.push(recordId);
        emit TaxRecordCreated(recordId, msg.sender);
    }

    function verifyTaxDecryption(
        string calldata recordId, 
        bytes memory abiEncodedClearTax,
        bytes memory decryptionProof
    ) external {
        require(bytes(taxRecords[recordId].recordId).length > 0, "Tax record does not exist");
        require(!taxRecords[recordId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(taxRecords[recordId].encryptedIncome);

        FHE.checkSignatures(cts, abiEncodedClearTax, decryptionProof);
        
        uint32 decodedTax = abi.decode(abiEncodedClearTax, (uint32));
        taxRecords[recordId].decryptedTax = decodedTax;
        taxRecords[recordId].isVerified = true;

        emit TaxDecryptionVerified(recordId, decodedTax);
    }

    function getEncryptedIncome(string calldata recordId) external view returns (euint32) {
        require(bytes(taxRecords[recordId].recordId).length > 0, "Tax record does not exist");
        return taxRecords[recordId].encryptedIncome;
    }

    function getTaxRecord(string calldata recordId) external view returns (
        string memory recordType,
        uint256 publicTaxRate,
        uint256 publicDeduction,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedTax
    ) {
        require(bytes(taxRecords[recordId].recordId).length > 0, "Tax record does not exist");
        TaxRecord storage data = taxRecords[recordId];

        return (
            data.recordType,
            data.publicTaxRate,
            data.publicDeduction,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedTax
        );
    }

    function getAllRecordIds() external view returns (string[] memory) {
        return recordIds;
    }

    function calculateTax(
        euint32 encryptedIncome,
        uint256 publicTaxRate,
        uint256 publicDeduction
    ) external returns (euint32 encryptedTax) {
        require(FHE.isInitialized(encryptedIncome), "Invalid encrypted input");

        euint32 memory encryptedDeduction = FHE.euint32(publicDeduction);
        euint32 memory encryptedTaxable = FHE.sub(encryptedIncome, encryptedDeduction);
        euint32 memory encryptedTax = FHE.mul(encryptedTaxable, FHE.euint32(publicTaxRate));

        return encryptedTax;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


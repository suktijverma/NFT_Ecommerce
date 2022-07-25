const Products = require('../models/product');
const Users = require('../models/user');
const {v1 : uuidv4} = require('uuid');
const fs = require('fs');
var solc = require('solc');
const Web3 = require('web3');
const Vonage = require('@vonage/server-sdk');
const nodemailer = require('nodemailer');
const vonage = new Vonage({
  apiKey: 'd1a71064',
  apiSecret: 'ummlrwteam40uIzP'
});
const from = "Vonage APIs";

const ACCOUNT_ADDRESS = '0x9695448338e2fD23FfE59568e20038684D4E026a';
const PRIVATE_KEY = '0xc7e0b2e4c28026f5acc1c98fe08a807189941e44fc91159063c55c57cf6df0e3';
const WEB3_PROVIDER_URL = 'https://rinkeby.infura.io/v3/d8dcbc716e9846ba82f8f5fc16f9c106';
const PRIVATE_KEY2 = 'c7e0b2e4c28026f5acc1c98fe08a807189941e44fc91159063c55c57cf6df0e3';

const web3 = new Web3(WEB3_PROVIDER_URL);

const source = fs.readFileSync('./contracts/Warranty.sol').toString();

const input = {
  language: 'Solidity',
  sources: { 'Warranty.sol': { content: source } },
  settings: { outputSelection: { '*': { '*': ['*'] } } }
};
            
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts['Warranty.sol']['Warranty'].evm.bytecode.object;
const abi = output.contracts['Warranty.sol']['Warranty'].abi;
            
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);

const {create} = require('ipfs-http-client');

async function ipfsClient() {
    const ipfs = await create({
        host: "ipfs.infura.io",
        port: 5001,
        protocol: "https"
    });
    return ipfs;
} 

const productCtrl = {
    createProduct: async (req, res) => {
        try{
            const {name, symbol, warrantyTime, soulbound } = req.body;
            
            const contract = new web3.eth.Contract(abi);
            const options = {
              data: `0x${bytecode}`,
              arguments: [name , symbol, soulbound]
            };
            const transaction = contract.deploy(options);
            const options2 = {
              data: transaction.encodeABI(),
              gas: 3000000,
              gasPrice: 20000000000,
              chainId: 4
            }
            const signed = await web3.eth.accounts.signTransaction(options2, String(account.privateKey));
            const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
            console.log(receipt);
            const contractAddress = receipt.contractAddress;
            const serialNo = uuidv4();
            const newProduct = new Products({
                name, symbol, serialNo, warrantyTime, soulbound, contractAddress
            })
            
            await newProduct.save();

            res.json({ 
                msg: 'Product created',
                newProduct
            }) 
        }catch(err){
            return res.status(500).json({msg: err.message});
        }
    },
    userbuy: async (req, res) => {
        try{
          const { address, emailId, phoneNo} = req.body;
          const product = await Products.findById(req.params.id);
          const days = (product.warrantyTime)*365;
          var date = new Date();
          date.setDate(date.getDate() + days);
          const timest = Math.floor(date.getTime()/1000);
          date.setHours(0, 0, 0, 0);
          const modelNo = uuidv4();
          const serialNo = product.serialNo;
          const name = product.name;
          let ipfs = await ipfsClient();

          let result = await ipfs.add(`{
            "name": "Warranty for ${name}",
            "image": "https://gateway.pinata.cloud/ipfs/QmPVfGttcxWSdzvN2FwRPraPdVVQRQwR7Gn1m9cmXcdV9z", 
            "attributes":[
              {
                "trait_type":"modelNo",
                "value":"${modelNo}"
              },
              {
                "trait_type":"serialNo",
                "value":"${serialNo}"
              },
              {
                "display_type": "date", 
                "trait_type": "expiry date", 
                "value": ${timest}
              }
            ] 
          }`);

          const metadatapath = `https://ipfs.io/ipfs/${result.path}`;

          let contractinstance = new web3.eth.Contract(abi, product.contractAddress);
          const tx = contractinstance.methods.safeMint(address, metadatapath);
          const data = tx.encodeABI();
          const nonce = await web3.eth.getTransactionCount(ACCOUNT_ADDRESS);
          const signedTx = await web3.eth.accounts.signTransaction(
            {
            to: product.contractAddress, 
            data,
            gas: 3000000,
            gasPrice: 20000000000,
            nonce, 
            chainId: 4
            },
            PRIVATE_KEY2
          );
          const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
          console.log(receipt);
          var count = await contractinstance.methods.getTokenId().call({from:ACCOUNT_ADDRESS});

          const newUser = new Users({
            product:product._id, address, emailId, phoneNo, modelNo, contractAddress:product.contractAddress, ExpiryDate:date, tokenId:count-1
          })
        
          await newUser.save();
        
          await Products.findOneAndUpdate({_id: req.params.id},{
            $push: {users: newUser._id}
          },{new: true});

          const to = `91${phoneNo}`;
          const text = `Your warranty NFT is ready for the product ${product.name}. Please visit opensea website and connect your wallet with the same address that you gave at the time of buying and you will your nft there.`;
          vonage.message.sendSms(from, to, text, (err, responseData) => {
          if (err) {
            console.log(err);
          } else {
            if(responseData.messages[0]['status'] === "0") {
              console.log("Message sent successfully.");
            } else {
              console.log(`Message failed with error: ${responseData.messages[0]['error-text']}`);
            }
          }
          });
          var transporter = nodemailer.createTransport({
            service: 'hotmail',
            auth: {
              user: 'flipkartwarrantytest@hotmail.com',
              pass: 'flipkart@nft'
            }
          });

          var mailOptions = {
            from: 'flipkartwarrantytest@hotmail.com',
            to: `${emailId}`,
            subject: 'Flipkart Warranty nft',
            text: `Your warranty NFT is ready for the product ${product.name}. Please visit opensea website and connect your wallet with the same address that you gave at the time of buying and you will your nft there.`        
          };

          transporter.sendMail(mailOptions, function(error, info){
            if (error) {
              console.log(error);
            } else {
              console.log('Email sent: ' + info.response);
            }
          });

          res.json({ 
            msg: 'User Warranty Mint',
            newUser
          })
        }catch(err){
            return res.status(500).json({msg: err.message});
        }
    }
}

module.exports = productCtrl;
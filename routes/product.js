const router = require('express').Router();
const productCtrl = require('../controllers/product');

router.post('/product', productCtrl.createProduct);
router.post('/userbuy/:id', productCtrl.userbuy);

module.exports = router;
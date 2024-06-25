const express = require("express");
const app = express()
const cors = require("cors");
const jwt = require("jsonwebtoken");
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;


//middlewares
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASSWORD}@cluster0.c4vqagl.mongodb.net/?retryWrites=true&w=majority`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    //await client.connect();
    const userCollection = client.db("bistroDB").collection("user");
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const paymentCollection = client.db("bistroDB").collection("payments");

    
    app.post('/jwt',(req,res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({token})
    })

    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await userCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' });
      }
      next();
    }

    app.get('/users',verifyJWT,verifyAdmin,async(req,res)=>{
      const result = await userCollection.find().toArray()
      res.send(result)
    })

    app.post('/users',async(req,res)=>{
      const user = req.body;
      console.log(user)
      const query = {email : user.email}
      const existingUser = await userCollection.findOne(query);
      console.log('Existing user',existingUser)
      if(existingUser){
        return res.send({message:'User Already Exists'})
      }
      const result = await userCollection.insertOne(user)
      res.send(result);
    })

    app.patch('/users/admin/:id',async(req,res)=>{
      const id = req.params.id;
      const filter = {_id:new ObjectId(id)}
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result)
    })
    //for checking the user is admin or not
    app.get('/users/admin/:email',verifyJWT,async(req,res)=>{
      const email = req.params.email;
      const query = {email : email}
      if(req.decoded.email !== email){
        res.send({admin:false})
      }
      const user = await userCollection.findOne(query)
      const result = {admin:user?.role==="admin"}
      console.log(result)
      res.send(result)
      
    })

    app.delete('/user/:email',async(req,res)=>{
      const email = req.params.email
      const query ={email:email}
      const result = await userCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/menu',async(req,res)=>{
        const result = await menuCollection.find().toArray();
        res.send(result);
    })

    app.post('/menu',verifyJWT,verifyAdmin,async(req,res)=>{
        const newItem = req.body
        const result = await menuCollection.insertOne(newItem)
        res.send(result)
    })

    app.delete('/menu/:id',verifyJWT,verifyAdmin,async(req,res)=>{
      const id =  req.params.id
      const query = {_id: (new ObjectId(id))}
      const result = await menuCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/reviews',async(req,res)=>{
        const result = await reviewCollection.find().toArray();
        res.send(result);
    })
    app.get('/carts',verifyJWT,async(req,res)=>{
      const email = req.query.email
      if(!email){
        res.send([]);
      }
      const decodedEmail = req.decoded.email
      if(email !== decodedEmail){
        return res.status(403).send({error:true,message: 'Forbidden Access' });
      }
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    })

    
    app.post('/carts',async(req,res)=>{
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/carts/:id',async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result)
    })

    // create payment intent
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseFloat((price * 100).toFixed(2)); //to convert in cents 
      // console.log(price,amount)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    // payment apis
    app.post('/payments',async(req,res)=>{
      const payment = req.body
      const insertResult = await paymentCollection.insertOne(payment)

      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollection.deleteMany(query)

      res.send({insertResult,deleteResult})
    })


    app.get('/admin-stats',verifyJWT,verifyAdmin,async(req,res)=>{
      const users = await userCollection.estimatedDocumentCount()
      const products = await menuCollection.estimatedDocumentCount()
      const orders = await paymentCollection.estimatedDocumentCount()
      //i can use aggregate for this sum TODO
      const payment = await paymentCollection.find().toArray()
      const revenue = payment.reduce((sum,item)=>sum+item.price,0)

      res.send({
        users,
        products,
        orders,
        revenue
      })
    })

    /**
     * ---------------
     * BANGLA SYSTEM(second best solution)
     * ---------------
     * 1. load all payments
     * 2. for each payment, get the menuItems array
     * 3. for each item in the menuItems array get the menuItem from the menu collection
     * 4. put them in an array: allOrderedItems
     * 5. separate allOrderedItems by category using filter
     * 6. now get the quantity by using length: pizzas.length
     * 7. for each category use reduce to get the total amount spent on this category
     * 
    */
    app.get('/order-stats',verifyJWT,verifyAdmin, async(req, res) =>{
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData'
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1 },
            total: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$total', 2] },
            _id: 0
          }
        }
      ];

      const result = await paymentCollection.aggregate(pipeline).toArray()
      res.send(result)

    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/',(req,res)=>{
    res.send("Running")
})
app.listen(port,()=>{
    console.log(`The port is running on ${port}`)
})
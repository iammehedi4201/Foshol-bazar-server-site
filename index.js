const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yuoqy9c.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyjWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "you have no authoraization key " });
  }
  const token = authorization.split(" ")[1];
  //verify the token
  jwt.verify(token, process.env.ACCESS_TOKEN_SCRETE_KEY, (error, decoded) => {
    //this conditon check the token expierydate
    if (error) {
      return res
        .status(403)
        .send({ error: true, message: "you token expiary data is over" });
    }
    //decode the infromation from token
    req.decoded = decoded;

    next();
  });
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const productCollection = client.db("Foshol-bazar").collection("Products");
    const userCartsCollection = client
      .db("Foshol-bazar")
      .collection("userCarts");
    const orderCollection = client.db("Foshol-bazar").collection("Orders");
    const userCollection = client.db("Foshol-bazar").collection("Users");

    /*------------jWT Api ------------- */

    app.post("/jwt", async (req, res) => {
      const userInfo = req.body;
      const token = jwt.sign(userInfo, process.env.ACCESS_TOKEN_SCRETE_KEY, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    /*------------Users Api ------------- */

    //! warrning : use VerifyJwt before using verifyAdmin
    //middleware for verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({
          error: true,
          message: "you are not admin to access the information",
        });
      }
      next();
    };

    //Read users
    app.get("/users", verifyjWT, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    //insert users
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const query = { email: userInfo.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ meassage: "User is already exist" });
      }
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    //Make Admin
    app.patch("/users/admin/:id", verifyjWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    //check if he or she admin or not
    app.get("/users/admin/:email", verifyjWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // ----------Products api------------

    //read products
    app.get("/products", async (req, res) => {
      const searchValue = req.query.search;
      const category = req.query.category;
      let currentPage = parseInt(req.query.currentPage);
      const pageSize = parseInt(req.query.pageSize);
      let query = {};

      if (category) {
        query = { categories: category };
      }

      if (searchValue) {
        query = {
          $or: [
            { name: { $regex: searchValue, $options: "i" } },
            { categories: { $regex: searchValue, $options: "i" } },
          ],
        };
      }

      const cursor = productCollection.find(query);
      const productsCount = await cursor.count();
      const products = await cursor
        .skip(currentPage * pageSize)
        .limit(pageSize)
        .toArray();

      res.send({ productsCount, products });
    });

    // ----------carts item api------------

    //Read cart items
    app.get("/cart-items", verifyjWT, async (req, res) => {
      const decoded = req.decoded;
      if (decoded.email !== req.query.email) {
        return res.status(403).send({
          error: true,
          message: "you have not right access other information ",
        });
      }
      let query = {};
      if (req.query.email) {
        query = { userEmail: req.query.email };
      }
      // console.log(query);
      const orders = await userCartsCollection.find(query).toArray();
      res.send(orders);
    });

    //insert cart items
    app.post("/cart-items", async (req, res) => {
      const cartItem = req.body;
      const cartItemId = cartItem.orderID;
      // console.log(orderId);
      const query = { orderID: cartItemId };
      const options = { upsert: true }; //We use the upsert: true option in the updateOne method to perform an upsert operation. This means that if an order with the given orderId exists, it will be updated with the new values provided in order. If it doesn't exist, a new order will be inserted with the provided data.
      const result = await userCartsCollection.updateOne(
        query,
        { $set: cartItem },
        options
      );
      res.send(result);
    });

    //Delete cart items
    app.delete("/cart-items/:id", async (req, res) => {
      const cartItemsId = req.params.id;
      const query = { _id: new ObjectId(cartItemsId) };
      const result = await userCartsCollection.deleteOne(query);
      res.send(result);
    });

    //update cart items
    app.put("/cart-items/:id", async (req, res) => {
      const id = req.params.id;
      const updateCartItemQuantity = req.body;
      // console.log(updateCartItemQuantity);
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const result = await userCartsCollection.updateOne(
        query,
        { $set: updateCartItemQuantity },
        options
      );
      res.send(result);
    });

    // ----------order api------------

    app.post("/orders", async (req, res) => {
      const orderInfo = req.body;
      const result = await orderCollection.insertOne(orderInfo);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Hello World!"));
app.listen(port, () => console.log(`Example app listening on port ${port}!`));

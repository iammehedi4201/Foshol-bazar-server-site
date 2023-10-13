const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const SSLCommerzPayment = require("sslcommerz-lts");
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

//--------------for sslCommerz-------------
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false; //true for live, false for sandbox

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
    const reviewCollection = client.db("Foshol-bazar").collection("Reviews");

    /*------------jWT Api ------------- */

    app.post("/jwt", async (req, res) => {
      const userInfo = req.body;
      const token = jwt.sign(userInfo, process.env.ACCESS_TOKEN_SCRETE_KEY, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    /*------------verifyAdmin  middleware------------- */
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

    /*------------admin home  Api ------------- */

    //Admin stats
    app.get("/admin-stats", verifyjWT, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const products = await productCollection.estimatedDocumentCount();
      const orders = await orderCollection.estimatedDocumentCount();
      const revenus = await orderCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalPrice: { $sum: "$totalPrice" },
            },
          },
        ])
        .toArray();

      res.send({
        userCount: users,
        productsCount: products,
        orderCounts: orders,
        revenus: revenus[0].totalPrice,
      });
    });

    //order-Stats
    app.get("/order-stats", verifyjWT, verifyAdmin, async (req, res) => {
      const pipline = [
        {
          $unwind: "$orderItems",
        },
        {
          $addFields: {
            ProductIDobj: { $toObjectId: "$orderItems.ProductID" },
          },
        },
        {
          $lookup: {
            from: "Products",
            localField: "ProductIDobj",
            foreignField: "_id",
            as: "products",
          },
        },
        {
          $unwind: "$products",
        },
        {
          $group: {
            _id: "$products.categories",
            count: { $sum: 1 },
            SelledProducts: { $addToSet: "$products.name" },
            totalPrice: { $sum: "$products.price" },
          },
        },
      ];

      const result = await orderCollection.aggregate(pipline).toArray();
      res.send(result);
    });

    //category stats
    app.get("/category-stats", verifyjWT, verifyAdmin, async (req, res) => {
      const pipline = [
        {
          $group: {
            _id: "$categories",
            count: { $sum: 1 },
            productsName: { $addToSet: "$name" },
          },
        },
        {
          $project: {
            category: "$_id",
            count: 1,
            productsName: 1,
            _id: 0,
          },
        },
      ];
      const result = await productCollection.aggregate(pipline).toArray();
      res.send(result);
    });

    //Selled Product stats
    app.get("/sellproducts-stats", verifyjWT, verifyAdmin, async (req, res) => {
      const pipline = [
        {
          $unwind: "$orderItems",
        },
        {
          $group: {
            _id: "$orderItems.productName",
            count: { $sum: 1 },
            totalSelledPrice: {
              $sum: {
                $multiply: [
                  { $ifNull: [{ $toInt: "$orderItems.productPrice" }, 0] },
                  { $ifNull: ["$orderItems.productQuantity", 0] },
                ],
              },
            },
            photoUrl: { $addToSet: "$orderItems.productImg" },
          },
        },
        {
          $sort: { totalSelledPrice: -1 },
        },
        {
          $project: {
            productName: "$_id",
            count: 1,
            totalSelledPrice: 1,
            photoUrl: 1,
            _id: 0,
          },
        },
      ];

      const result = await orderCollection.aggregate(pipline).toArray();
      res.send(result);
    });

    //Top customar stats
    app.get("/topCustomar-stats", verifyjWT, verifyAdmin, async (req, res) => {
      const pipline = [
        {
          $unwind: "$orderItems",
        },
        {
          $group: {
            _id: "$customerEmail",
            customarName: { $addToSet: "$customerName" },
            buyProductCount: { $sum: "$orderItems.productQuantity" },
            totalSpent: {
              $sum: {
                $multiply: [
                  { $ifNull: [{ $toInt: "$orderItems.productPrice" }, 0] },
                  { $ifNull: ["$orderItems.productQuantity", 0] },
                ],
              },
            },
          },
        },
        {
          $sort: { totalSpent: -1 },
        },
        {
          $project: {
            customarEmail: "$_id",
            customarName: 1,
            buyProductCount: 1,
            totalSpent: 1,
            _id: 0,
          },
        },
      ];
      const result = await orderCollection.aggregate(pipline).toArray();
      res.send(result);
    });

    /*------------Users Api ------------- */

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
    app.patch("/users/admin/:id", verifyjWT, verifyAdmin, async (req, res) => {
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

    //Delete user
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    //check if he or she admin or not
    app.get("/users/admin/:email", verifyjWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.send({ admin: false });
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

    //Add product
    app.post("/newproducts", verifyjWT, verifyAdmin, async (req, res) => {
      const newProduct = req.body;
      const result = await productCollection.insertOne(newProduct);
      res.send(result);
    });

    //update product
    app.put("/products/:id", verifyjWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updateInfo = req.body;
      console.log(id, updateInfo);
      let query = {};
      if (id) {
        query = { _id: new ObjectId(id) };
      }

      const result = await productCollection.updateOne(query, {
        $set: {
          name: updateInfo.name,
          rating: updateInfo.rating,
          price: updateInfo.price,
          categories: updateInfo.categories,
          description: updateInfo.description,
          img: updateInfo.img,
        },
      });
      res.send(result);
    });

    app.delete("/products/:id", verifyjWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.deleteOne(query);
      res.send(result);
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
      const cartItemId = cartItem.ProductID;
      // console.log(ProductID);
      const query = { ProductID: cartItemId };
      const options = { upsert: true }; //We use the upsert: true option in the updateOne method to perform an upsert operation. This means that if an order with the given ProductID exists, it will be updated with the new values provided in order. If it doesn't exist, a new order will be inserted with the provided data.
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

    //-------------order api---------------

    //Read orders
    app.get("/orders", verifyjWT, async (req, res) => {
      console.log("Order api is called", req.query.email);
      if (req.query.email) {
        const query = { customerEmail: req.query.email };
        const orders = await orderCollection.find(query).toArray();
        res.send(orders);
      } else {
        const orders = await orderCollection.find().toArray();
        res.send(orders);
      }
    });

    //insert Orders
    app.post("/orders", verifyjWT, async (req, res) => {
      const tran_id = new ObjectId().toString(); //this for tran_Id
      const orderInfo = req.body;
      console.log("orderInfo is :-", orderInfo);
      const data = {
        total_amount: orderInfo.totalPrice,
        currency: "BDT",
        tran_id: tran_id, // use unique tran_id for each api call
        success_url: `https://foshol-bazar-server-site.vercel.app/payment/success/${tran_id}`, //in this use vercel link
        fail_url: `https://foshol-bazar-server-site.vercel.app/payment/fail/${tran_id}`, //in this use vercel link
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: orderInfo.deilveryMethod,
        product_name: orderInfo?.orderItems
          .map((product) => product.productName)
          .join(),
        product_category: "vegetables",
        product_profile: "general",
        cus_name: orderInfo.customerName,
        cus_email: orderInfo.customerEmail,
        cus_add1: orderInfo.shippingAddress?.address,
        cus_state: orderInfo?.shippingAddress?.city,
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: orderInfo.phoneNumber,
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      // console.log(data);
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });
      });

      //insert order into orderColleciton
      orderInfo.paidStatus = false;
      orderInfo.status = "Pending";
      orderInfo.transactionId = tran_id;
      orderInfo.orderItems = orderInfo.orderItems.map((product) => ({
        ...product,
        reviewStatus: false,
      }));
      const insertResut = await orderCollection.insertOne(orderInfo);

      //New success route
      app.post("/payment/success/:tranId", async (req, res) => {
        const query = { transactionId: req.params.tranId };
        // const qureyTwo = {
        //   _id: { $in: orderInfo.cartItemId.map((id) => new ObjectId(id)) },
        // };
        const updatedResult = await orderCollection.updateOne(query, {
          $set: {
            paidStatus: true,
          },
        });

        // console.log("query Two is :-", qureyTwo);

        // const deletedResult = await userCartsCollection.deleteMany(qureyTwo);
        if (updatedResult.modifiedCount > 0) {
          res.redirect(
            `https://foshol-bazar.web.app/dashboard/payment/success/${req.params.tranId}` //in this use firbase link
          );
        }
      });

      //Faild Route
      app.post("/payment/fail/:tranId", async (req, res) => {
        const query = { transactionId: req.params.tranId };
        const deleteResult = await orderCollection.deleteOne(query);
        if (deleteResult.deletedCount > 0) {
          res.redirect(
            `https://foshol-bazar.web.app/dashboard/payment/fail/${req.params.tranId}` //in this use firbase link
          );
        }
      });
    });

    //update orders
    app.patch("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await orderCollection.updateOne(query, {
        $set: {
          status: "Done",
        },
      });
      res.send(result);
    });

    //After success Cart item deleted
    app.delete("/cartsItems/:id", async (req, res) => {
      const id = req.params.id;
      const query = { transactionId: id };
      const order = await orderCollection.findOne(query);
      const qureyTwo = {
        _id: { $in: order.cartItemId.map((id) => new ObjectId(id)) },
      };
      const deleteReuslt = await userCartsCollection.deleteMany(qureyTwo);
      res.send(deleteReuslt);
    });

    //------------------Review APi -------------------
    app.post("/reviews", async (req, res) => {
      const reviews = req.body;
      const { productID } = reviews;
      // console.log(productID);
      const updateResult = await orderCollection.updateOne(
        {
          "orderItems.ProductID": productID,  //!got error that   
        },
        { $set: { "orderItems.$.reviewStatus": true } }
      );
      const result = await reviewCollection.insertOne(reviews);
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

import dotenv from "dotenv";
import express, { json } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import cloudinary from "cloudinary";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();

const port = process.env.PORT || 5000;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;

const CLOUD_NAME = process.env.CLOUD_NAME;
const CLOUD_API_KEY = process.env.CLOUD_API_KEY;
const CLOUD_API_SECRET = process.env.CLOUD_API_SECRET;

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

// Cloudinary configuration
cloudinary.v2.config({
  cloud_name: CLOUD_NAME,
  api_key: CLOUD_API_KEY,
  api_secret: CLOUD_API_SECRET,
});

if (!DB_USER || !DB_PASS) {
  console.error(`Database credentials are missing in env`);
  process.exit(1);
}

const app = express();

// Middleware

app.use(json());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tourist-spot-9429c.web.app"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
      success: false,
      message: "Too many requests, please try againa later",
    },
  })
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(err.status || 500)
    .json({ success: false, message: err.message || "Internal server error" });
});

// Auth related API

app.post("/jwt", (req, res) => {
  const user = req.body;
  if (!user) {
    return res
      .status(401)
      .send({ success: false, message: "Verified email not found!" });
  }

  try {
    const token = jwt.sign(user, JWT_ACCESS_SECRET, { expiresIn: "1h" });
    if (!token) {
      return res
        .status(401)
        .send({ success: false, message: "jwt token generate failed" });
    }

    // console.log(user, token);

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
      })
      .send({ success: true });
  } catch (err) {
    console.log(`Error when jwt access token generate: ${err}`);
  }
});

// clear jwt access token from cookies
app.post("/jwt-logout", (req, res) => {
  res
    .clearCookie("token", {
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "none",
    })
    .send({ success: true });
});

// Auth related middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  // console.log("token from verifyToken: ", token);
  if (!token) {
    return res.status(403).send({
      success: false,
      message: "Unauthorized access. Please login to continue",
    });
  }

  try {
    jwt.verify(token, JWT_ACCESS_SECRET, (err, decoded) => {
      if (err) {
        return res
          .status(403)
          .send({ success: false, message: "Access forbidden" });
      }
      // console.log(decoded);
      req.user = decoded;
      next();
    });
  } catch (err) {
    console.log(`jwt verification error: ${err}`);
  }
};

// ----------------------END Auth API

// const uri = "mongodb://localhost:27017";
const uri = `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.2wh4i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// await client.connect();

await client.db("admin").command({ ping: 1 });
console.log("Pinged your deployment. You successfully connected to MongoDB!");

const database = client.db("travel-agency");
const collection = database.collection("tourist-spot");

// Check server running status
app.get("/", (req, res) => {
  res.send("Tourists server is running ...");
});

// Get all tourist spot data
app.get("/tourist-spot", async (req, res, next) => {
  try {
    const data = await collection.find().toArray();
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "No data found" });
    }
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Get all tourist spot data for a specific user
app.get("/tourist-spot/user/:email", verifyToken, async (req, res, next) => {
  const email = req.params.email;
  const verifiedUser = req.user?.user;
  // console.log(email, verifiedUser, req.cookies?.token);

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email parameter is required.",
    });
  }
  // console.log(`check both email are same: ${email === verifiedUser}`);

  if (email !== verifiedUser) {
    return res
      .status(403)
      .send({ success: false, message: "Access forbidden" });
  }

  try {
    // Query the database for the provided email
    const query = { userEmail: email };
    const data = await collection.find(query).toArray();

    if (!data || data.length === 0) {
      // Return 404 Not Found if no data exists for the user
      return res.status(404).json({
        success: false,
        message: "No data found for the provided email.",
      });
    }

    // Return data if found
    // console.log(`Data ready to serve: ${data}`);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// Get a single tourist spot data
app.get("/tourist-spot/:id", async (req, res, next) => {
  const id = req.params.id;
  try {
    const data = await collection.findOne({ _id: new ObjectId(id) });
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No data found",
      });
    }
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Add data in database
app.post("/tourist-spot", async (req, res, next) => {
  const touristData = req.body;
  // console.log(touristData);
  try {
    const newData = await collection.insertOne(touristData);
    if (!newData?.insertedId) {
      return res.status(500).json({
        success: false,
        message: "Failed to add new tourist spot",
      });
    }
    res.status(201).json({
      success: true,
      message: "Tourist spot added successfully",
      id: newData?.insertedId,
    });
  } catch (err) {
    next(err);
  }
});

// Deleted one tourist spot
app.delete("/tourist-spot/:id", async (req, res, next) => {
  const id = req.params.id;
  try {
    const filter = { _id: new ObjectId(id) };

    const tourist_spot = await collection.findOne(filter);
    if (tourist_spot?.imgHostingInfo?.public_id) {
      await cloudinary.uploader.destroy(
        tourist_spot?.imgHostingInfo?.public_id
      );
    }

    const data = await collection.deleteOne(filter);
    if (!data?.deletedCount) {
      return res
        .status(404)
        .json({ success: false, success: "No data found to delete" });
    }
    res.status(200).json({
      success: true,
      message: "Tourist spot deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

app.patch("/tourist-spot/:id", async (req, res, next) => {
  const id = req.params.id;
  const updateInfo = req.body;
  const {
    spot_name,
    country_name,
    location,
    details,
    average_cost,
    seasonality,
    travel_time,
    total_visitors_per_year,
    imgHostingInfo,
    ex_public_id,
  } = updateInfo;

  try {
    const filter = { _id: new ObjectId(id) };

    // Dynamically construct $set
    const updateFields = {
      spot_name,
      country_name,
      location,
      details,
      average_cost,
      seasonality,
      travel_time,
      total_visitors_per_year,
    };

    // Add imgHostingInfo only if it exists
    if (imgHostingInfo) {
      updateFields.imgHostingInfo = imgHostingInfo;
    }

    const updateDoc = { $set: updateFields };

    // Delete image from Cloudinary if ex_public_id exists
    if (ex_public_id) {
      await cloudinary.uploader.destroy(ex_public_id);
    }

    // Update the document in the database
    const dataUpdateRes = await collection.updateOne(filter, updateDoc);

    if (!dataUpdateRes?.modifiedCount) {
      return res.status(500).json({
        success: false,
        message: "Failed to update this document data",
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Tourist spot updated successfully" });
  } catch (err) {
    next(err);
  }
});

const serverStart = async () => {
  try {
    await client.connect();

    app.listen(port, () =>
      console.log(`Server listening port is: http://localhost:${port}`)
    );
  } catch (err) {
    console.log(`Error when server start: ${err}`);
    process.exit(1);
  }
};

serverStart();

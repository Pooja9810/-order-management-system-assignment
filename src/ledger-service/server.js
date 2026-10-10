import express from "express";

const app = express();
const PORT = 4004;

//This helps express read json from request bodies

app.use(express.json());

//health route

app.get("/health", (req, res) => {
  return res.json({
    status: "UP",
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

import express from "express";
const app = express();
const PORT = 4003;

//THIS helps express read json from request bodeis

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "UP",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

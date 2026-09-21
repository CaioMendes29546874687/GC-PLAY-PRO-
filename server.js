const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Rota principal
app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "GC PLAY PRO",
    version: "1.0.0",
    message: "Backend funcionando!"
  });
});

// Teste da API
app.get("/api/status", (req, res) => {
  res.json({
    online: true,
    service: "GC PLAY PRO API",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GC PLAY PRO API rodando na porta ${PORT}`);
});

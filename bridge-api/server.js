require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { RouterOSClient } = require("routeros-client");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_TOKEN = process.env.API_TOKEN || "troque_esta_senha_forte";

const servers = {
  mt1: {
    name: process.env.MT1_NAME || "AMAZONET",
    host: process.env.MT1_HOST || "10.200.200.1",
    port: Number(process.env.MT1_PORT || 8728),
    user: process.env.MT1_USER || "admin",
    password: process.env.MT1_PASS || ""
  },
  mt2: {
    name: process.env.MT2_NAME || "ARMANDO_MENDES",
    host: process.env.MT2_HOST || "10.200.200.2",
    port: Number(process.env.MT2_PORT || 8728),
    user: process.env.MT2_USER || "admin",
    password: process.env.MT2_PASS || ""
  }
};

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "").trim();

  if (!token || token !== API_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: "Token inválido ou ausente"
    });
  }

  next();
}

function getServer(id) {
  const server = servers[id];
  if (!server) {
    throw new Error("Servidor inválido. Use mt1 ou mt2.");
  }
  return server;
}

async function connect(serverId) {
  const server = getServer(serverId);

  const client = new RouterOSClient({
    host: server.host,
    user: server.user,
    password: server.password,
    port: server.port,
    timeout: 10000
  });

  await client.connect();
  return client;
}

async function runCommand(serverId, path, params = {}) {
  const client = await connect(serverId);
  try {
    const api = client.api(path);
    const result = await api.get(params);
    await client.close();
    return result;
  } catch (error) {
    try { await client.close(); } catch (_) {}
    throw error;
  }
}

async function writeCommand(serverId, path, data = {}) {
  const client = await connect(serverId);
  try {
    const api = client.api(path);
    const result = await api.add(data);
    await client.close();
    return result;
  } catch (error) {
    try { await client.close(); } catch (_) {}
    throw error;
  }
}

async function setCommand(serverId, path, id, data = {}) {
  const client = await connect(serverId);
  try {
    const api = client.api(path);
    const result = await api.set(id, data);
    await client.close();
    return result;
  } catch (error) {
    try { await client.close(); } catch (_) {}
    throw error;
  }
}

// Rota pública simples para teste
app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "MikroTik Bridge API",
    status: "online"
  });
});

// Daqui para baixo exige token
app.use("/api", authMiddleware);

// Lista servidores cadastrados na API
app.get("/api/servers", (req, res) => {
  res.json({
    ok: true,
    servers: Object.keys(servers).map((id) => ({
      id,
      name: servers[id].name,
      host: servers[id].host,
      port: servers[id].port
    }))
  });
});

// Testar conexão
app.get("/api/:serverId/ping", async (req, res) => {
  try {
    const { serverId } = req.params;
    const identity = await runCommand(serverId, "/system/identity");
    res.json({
      ok: true,
      server: servers[serverId].name,
      identity
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Status CPU / memória / uptime
app.get("/api/:serverId/status", async (req, res) => {
  try {
    const { serverId } = req.params;

    const resource = await runCommand(serverId, "/system/resource");
    const identity = await runCommand(serverId, "/system/identity");

    res.json({
      ok: true,
      server: servers[serverId].name,
      identity,
      resource
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Clientes PPPoE online
app.get("/api/:serverId/pppoe/online", async (req, res) => {
  try {
    const { serverId } = req.params;
    const online = await runCommand(serverId, "/ppp/active");

    res.json({
      ok: true,
      server: servers[serverId].name,
      total: Array.isArray(online) ? online.length : 0,
      online
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Lista secrets PPPoE
app.get("/api/:serverId/pppoe/secrets", async (req, res) => {
  try {
    const { serverId } = req.params;
    const secrets = await runCommand(serverId, "/ppp/secret");

    res.json({
      ok: true,
      server: servers[serverId].name,
      total: Array.isArray(secrets) ? secrets.length : 0,
      secrets
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Criar cliente PPPoE
app.post("/api/:serverId/pppoe/create", async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name, password, service, profile, comment } = req.body;

    if (!name || !password || !profile) {
      return res.status(400).json({
        ok: false,
        error: "Campos obrigatórios: name, password, profile"
      });
    }

    const result = await writeCommand(serverId, "/ppp/secret", {
      name,
      password,
      service: service || "pppoe",
      profile,
      comment: comment || "Criado pelo Fibra Hub"
    });

    res.json({
      ok: true,
      message: "Cliente PPPoE criado",
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Bloquear cliente PPPoE
app.post("/api/:serverId/pppoe/block", async (req, res) => {
  try {
    const { serverId } = req.params;
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        ok: false,
        error: "Informe o .id do secret PPPoE"
      });
    }

    const result = await setCommand(serverId, "/ppp/secret", id, {
      disabled: "yes"
    });

    res.json({
      ok: true,
      message: "Cliente bloqueado",
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Desbloquear cliente PPPoE
app.post("/api/:serverId/pppoe/unblock", async (req, res) => {
  try {
    const { serverId } = req.params;
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        ok: false,
        error: "Informe o .id do secret PPPoE"
      });
    }

    const result = await setCommand(serverId, "/ppp/secret", id, {
      disabled: "no"
    });

    res.json({
      ok: true,
      message: "Cliente desbloqueado",
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Alterar plano/profile
app.post("/api/:serverId/pppoe/change-profile", async (req, res) => {
  try {
    const { serverId } = req.params;
    const { id, profile } = req.body;

    if (!id || !profile) {
      return res.status(400).json({
        ok: false,
        error: "Informe id e profile"
      });
    }

    const result = await setCommand(serverId, "/ppp/secret", id, {
      profile
    });

    res.json({
      ok: true,
      message: "Plano alterado",
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`MikroTik Bridge API rodando na porta ${PORT}`);
});


const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const net = require("net");

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

function decodeLength(buffer, offset) {
  const first = buffer[offset];
  if ((first & 0x80) === 0x00) return { len: first, size: 1 };
  if ((first & 0xc0) === 0x80) return { len: ((first & ~0xc0) << 8) + buffer[offset + 1], size: 2 };
  if ((first & 0xe0) === 0xc0) return { len: ((first & ~0xe0) << 16) + (buffer[offset + 1] << 8) + buffer[offset + 2], size: 3 };
  if ((first & 0xf0) === 0xe0) return { len: ((first & ~0xf0) << 24) + (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3], size: 4 };
  return { len: (buffer[offset + 1] << 24) + (buffer[offset + 2] << 16) + (buffer[offset + 3] << 8) + buffer[offset + 4], size: 5 };
}

function encodeWord(word) {
  const data = Buffer.from(String(word), "utf8");
  return Buffer.concat([encodeLength(data.length), data]);
}

function encodeSentence(words) {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function parseSentences(buffer) {
  let offset = 0;
  const sentences = [];
  let current = [];

  while (offset < buffer.length) {
    const { len, size } = decodeLength(buffer, offset);
    offset += size;

    if (len === 0) {
      sentences.push(current);
      current = [];
      continue;
    }

    if (offset + len > buffer.length) break;
    current.push(buffer.slice(offset, offset + len).toString("utf8"));
    offset += len;
  }

  return sentences;
}

function routerosSend(host, port, user, pass, sentences, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let chunks = [];
    let finished = false;

    const finish = (err, result) => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("Timeout conectando na API MikroTik")));
    socket.on("error", err => finish(err));
    socket.on("data", chunk => chunks.push(chunk));

    socket.connect(Number(port || 8728), host, () => {
      socket.write(encodeSentence(["/login", `=name=${user}`, `=password=${pass}`]));

      setTimeout(() => {
        const loginResp = parseSentences(Buffer.concat(chunks)).flat().join(" ");
        if (loginResp.includes("!trap") || loginResp.toLowerCase().includes("invalid")) {
          return finish(new Error("Falha no login da API MikroTik"));
        }

        chunks = [];
        for (const words of sentences) {
          socket.write(encodeSentence(words));
        }
        socket.write(encodeSentence(["/quit"]));

        setTimeout(() => {
          const resp = parseSentences(Buffer.concat(chunks));
          const flat = resp.flat().join(" ");
          if (flat.includes("!trap")) {
            return finish(new Error("Erro retornado pelo MikroTik: " + flat));
          }
          finish(null, resp);
        }, 1200);
      }, 800);
    });
  });
}

function servidorConfig(nomeServidor) {
  const nome = String(nomeServidor || "").toUpperCase();

  if (nome.includes("ARMANDO")) {
    return {
      key: "armando",
      host: process.env.MIKROTIK_ARMANDO_HOST,
      port: process.env.MIKROTIK_ARMANDO_PORT || 8728,
      user: process.env.MIKROTIK_ARMANDO_USER,
      pass: process.env.MIKROTIK_ARMANDO_PASS
    };
  }

  return {
    key: "colonia",
    host: process.env.MIKROTIK_COLONIA_HOST,
    port: process.env.MIKROTIK_COLONIA_PORT || 8728,
    user: process.env.MIKROTIK_COLONIA_USER,
    pass: process.env.MIKROTIK_COLONIA_PASS
  };
}

async function criarPPPoECliente(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas no Render para " + cfg.key);
  }

  const usuario = cliente.pppoe || cliente.usuario || "";
  const senha = cliente.senha || "";
  const plano = cliente.plano || "default";

  if (!usuario || !senha) {
    throw new Error("Usuário PPPoE ou senha não informado.");
  }

  const comentario = [
    cliente.nome ? `CLIENTE: ${cliente.nome}` : "",
    cliente.telefone ? `TEL: ${cliente.telefone}` : "",
    cliente.servidor ? `SERVIDOR: ${cliente.servidor}` : "",
    cliente.valor ? `VALOR: ${cliente.valor}` : ""
  ].filter(Boolean).join(" | ");

  const words = [
    "/ppp/secret/add",
    `=name=${usuario}`,
    `=password=${senha}`,
    "=service=pppoe",
    `=profile=${plano}`,
    `=comment=${comentario}`
  ];

  return routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [words]);
}


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const TOKEN = process.env.PANEL_TOKEN || "fibra2026";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

let servidores = {
  colonia: {
    servidor: "colonia",
    nome: "COLÔNIA ANTÔNIO ALEIXO",
    online: false,
    atualizadoEm: null,
    identity: "COLÔNIA ANTÔNIO ALEIXO",
    cpu: "0",
    uptime: "--",
    pppoeOnline: 0,
    download: "0 Mbps",
    upload: "0 Mbps",
    interfaces: [],
    clientes: []
  },
  armando: {
    servidor: "armando",
    nome: "ARMANDO MENDES",
    online: false,
    atualizadoEm: null,
    identity: "ARMANDO MENDES",
    cpu: "0",
    uptime: "--",
    pppoeOnline: 0,
    download: "0 Mbps",
    upload: "0 Mbps",
    interfaces: [],
    clientes: []
  }
};

function n(v) {
  if (!v) return 0;
  return Number(String(v).replace("Mbps","").replace("Mb","").replace(",",".").trim()) || 0;
}

function geral() {
  const lista = Object.values(servidores);
  const clientes = lista.flatMap(s => (s.clientes || []).map(c => ({ ...c, servidor: s.nome })));
  return {
    atualizadoEm: new Date().toISOString(),
    servidores,
    totalServidores: lista.length,
    servidoresOnline: lista.filter(s => s.online).length,
    pppoeOnline: lista.reduce((a,s)=>a+Number(s.pppoeOnline || 0),0),
    download: lista.reduce((a,s)=>a+n(s.download),0).toFixed(1) + " Mbps",
    upload: lista.reduce((a,s)=>a+n(s.upload),0).toFixed(1) + " Mbps",
    cpuMedia: Math.round(lista.reduce((a,s)=>a+Number(s.cpu || 0),0) / lista.length),
    clientes
  };
}

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      servidor TEXT,
      cpf TEXT,
      telefone TEXT,
      cep TEXT,
      endereco TEXT,
      numero TEXT,
      complemento TEXT,
      referencia TEXT,
      bairro TEXT,
      plano TEXT,
      pppoe TEXT,
      acesso_remoto TEXT,
      senha TEXT,
      vencimento TEXT,
      valor TEXT,
      status TEXT DEFAULT 'ativo',
      confianca_ate TEXT,
      observacoes TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cep TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS numero TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS complemento TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS referencia TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS servidor TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acesso_remoto TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS confianca_ate TEXT;");
  console.log("PostgreSQL conectado.");
}


function rateLimitPorPlano(plano) {
  const p = String(plano || "").toLowerCase();
  const match = p.match(/(\d+)/);
  if (!match) return "";
  let numero = Number(match[1]);
  if (p.includes("giga") || p.includes("1g")) numero = 1000;
  if (!numero) return "";
  return `${numero}M/${numero}M`;
}

async function criarPPPoEClienteComProfile(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas no Render para " + cfg.key);
  }

  const usuario = cliente.pppoe || cliente.usuario || "";
  const senha = cliente.senha || "";
  const plano = cliente.plano || "default";

  if (!usuario || !senha) {
    throw new Error("Usuário PPPoE ou senha não informado.");
  }

  const rateLimit = rateLimitPorPlano(plano);
  const comentario = [
    cliente.nome ? `CLIENTE: ${cliente.nome}` : "",
    cliente.telefone ? `TEL: ${cliente.telefone}` : "",
    cliente.servidor ? `SERVIDOR: ${cliente.servidor}` : "",
    cliente.valor ? `VALOR: ${cliente.valor}` : ""
  ].filter(Boolean).join(" | ");

  // 1) Primeiro tenta criar o profile/plano.
  // Se já existir, ignora e continua.
  if (plano && plano !== "default") {
    const profileWords = [
      "/ppp/profile/add",
      `=name=${plano}`
    ];

    if (rateLimit) profileWords.push(`=rate-limit=${rateLimit}`);

    try {
      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [profileWords]);
    } catch (e) {
      const msg = String(e.message || "").toLowerCase();
      const jaExiste = msg.includes("already exists") || msg.includes("already have") || msg.includes("same name");
      if (!jaExiste) {
        throw e;
      }
      console.log("Profile já existe no MikroTik, continuando:", plano);
    }
  }

  // 2) Depois cria o PPP Secret.
  // Se o cliente já existir, retorna erro claro.
  const secretWords = [
    "/ppp/secret/add",
    `=name=${usuario}`,
    `=password=${senha}`,
    "=service=pppoe",
    `=profile=${plano}`,
    `=comment=${comentario}`
  ];

  return routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [secretWords]);
}



function parseRouterosRows(sentences) {
  const rows = [];
  for (const sentence of sentences || []) {
    if (!Array.isArray(sentence)) continue;
    if (!sentence.includes("!re")) continue;
    const row = {};
    for (const word of sentence) {
      if (word.startsWith("=")) {
        const idx = word.indexOf("=", 1);
        if (idx > 0) {
          const key = word.slice(1, idx);
          const value = word.slice(idx + 1);
          row[key] = value;
        }
      }
    }
    rows.push(row);
  }
  return rows;
}


async function consultarStatusMikroTik(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
  if (!usuario) {
    return { status: "nao_provisionado", texto: "⚫ Não provisionado", detalhe: "Cliente sem usuário PPPoE." };
  }

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const secretResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/secret/print",
    `?name=${usuario}`
  ]]);

  const activeRows = parseRouterosRows(activeResp);
  const secretRows = parseRouterosRows(secretResp);

  const active = activeRows[0];
  const secret = secretRows[0];

  const agora = new Date();
  const confiancaAte = cliente.confianca_ate ? new Date(cliente.confianca_ate) : null;

  if (!secret) {
    return {
      status: "nao_provisionado",
      texto: "⚫ Não provisionado",
      detalhe: "PPP Secret não encontrado no MikroTik.",
      pppoe: usuario
    };
  }

  if (secret.disabled === "true" || secret.disabled === "yes") {
    if (confiancaAte && confiancaAte > agora) {
      return {
        status: "confianca",
        texto: "⭐ Em confiança",
        detalhe: "Cliente está em confiança.",
        confianca_ate: cliente.confianca_ate,
        pppoe: usuario,
        ip: active ? active.address : "",
        uptime: active ? active.uptime : ""
      };
    }

    return {
      status: "bloqueado",
      texto: "🟡 Bloqueado",
      detalhe: "PPP Secret desativado no MikroTik.",
      pppoe: usuario
    };
  }

  if (confiancaAte && confiancaAte > agora) {
    return {
      status: "confianca",
      texto: "⭐ Em confiança",
      detalhe: "Liberado em confiança.",
      confianca_ate: cliente.confianca_ate,
      pppoe: usuario,
      ip: active ? active.address : "",
      uptime: active ? active.uptime : "",
      caller_id: active ? active["caller-id"] : ""
    };
  }

  if (active) {
    return {
      status: "online",
      texto: "🟢 Online",
      detalhe: "Cliente conectado no PPPoE.",
      pppoe: usuario,
      ip: active.address || "",
      uptime: active.uptime || "",
      caller_id: active["caller-id"] || "",
      service: active.service || ""
    };
  }

  return {
    status: "offline",
    texto: "🔴 Offline",
    detalhe: "PPP Secret existe, mas o cliente não está conectado.",
    pppoe: usuario
  };
}


app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));




app.get("/api/login-teste", (req, res) => {
  res.json({ ok: true, login: "admin/admin ativo" });
});


app.post("/api/login", async (req, res) => {
  try {
    const body = req.body || {};
    const usuario = String(body.usuario || body.login || body.user || "").trim();
    const senha = String(body.senha || body.password || body.pass || "").trim();

    if (usuario === "admin" && senha === "admin") {
      return res.json({
        ok: true,
        token: "fibra-admin",
        usuario: { usuario: "admin", nome: "Administrador", tipo: "admin" }
      });
    }

    try {
      const r = await pool.query(
        "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2 LIMIT 1",
        [usuario, senha]
      );

      if (r.rows.length) {
        return res.json({ ok: true, token: "fibra-admin", usuario: r.rows[0] });
      }
    } catch (e) {
      console.log("Login banco ignorado:", e.message);
    }

    return res.status(401).json({ ok: false, erro: "Usuário ou senha inválidos" });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


app.get("/api/status",(req,res)=>{
  res.json({ sistema:"Fibra+ Hub 2 Servidores", status:"online", banco:!!process.env.DATABASE_URL, versao:"10.0.0" });
});

app.post("/api/update",(req,res)=>{
  const token = req.headers["x-panel-token"] || req.body.token;
  if (token !== TOKEN) return res.status(401).json({ ok:false, erro:"Token inválido" });

  let chave = (req.body.servidor || req.body.pop || req.body.identity || "colonia").toString().toLowerCase();
  if (chave.includes("armando")) chave = "armando";
  else if (chave.includes("colonia") || chave.includes("colônia")) chave = "colonia";

  if (!servidores[chave]) {
    servidores[chave] = { servidor: chave, nome: chave.toUpperCase(), online: false, clientes: [], interfaces: [] };
  }

  servidores[chave] = {
    ...servidores[chave],
    servidor: chave,
    nome: req.body.nomeServidor || servidores[chave].nome || req.body.identity || chave.toUpperCase(),
    online: true,
    atualizadoEm: new Date().toISOString(),
    origem: req.ip,
    identity: req.body.identity || servidores[chave].identity,
    cpu: req.body.cpu || "0",
    uptime: req.body.uptime || "--",
    memoriaLivre: req.body.memoriaLivre || "--",
    pppoeOnline: Number(req.body.pppoeOnline || 0),
    download: req.body.download || "0 Mbps",
    upload: req.body.upload || "0 Mbps",
    interfaces: Array.isArray(req.body.interfaces) ? req.body.interfaces : [],
    clientes: Array.isArray(req.body.clientes) ? req.body.clientes : [],
    raw: req.body
  };

  const payload = geral();
  io.emit("hub-update", payload);
  io.emit("mikrotik-update", payload);
  res.json({ ok:true, recebido:true, servidor:chave, geral: payload });
});

app.get("/api/latest",(req,res)=>res.json(geral()));

app.get("/api/status-atual", (req, res) => {
  try {
    const valores = Object.values(statusServidores || {});
    if (valores.length) {
      return res.json(valores[valores.length - 1]);
    }
    res.json({});
  } catch (e) {
    res.json({});
  }
});

app.get("/api/servidores",(req,res)=>res.json(servidores));

app.get("/api/clientes", async (req,res)=>{
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id DESC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ erro:e.message }); }
});

app.post("/api/clientes", async (req, res) => {
  try {
    const c = req.body;
    const result = await pool.query(
      `INSERT INTO clientes 
      (nome, servidor, cpf, telefone, cep, endereco, numero, complemento, bairro, referencia, plano, pppoe, acesso_remoto, senha, vencimento, valor, status, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        c.nome || "",
        c.servidor || "",
        c.cpf || "",
        c.telefone || "",
        c.cep || "",
        c.endereco || "",
        c.numero || "",
        c.complemento || "",
        c.bairro || "",
        c.referencia || "",
        c.plano || "",
        c.pppoe || "",
        c.acessoRemoto || c.acesso_remoto || "",
        c.senha || "",
        c.vencimento || "",
        c.valor || "",
        c.status || "ativo",
        c.observacoes || ""
      ]
    );

    let pppoeCriado = false;
    let pppoeErro = null;

    try {
      await criarPPPoEClienteComProfile(result.rows[0]);
      pppoeCriado = true;
    } catch (erroPPPoE) {
      pppoeErro = erroPPPoE.message;
      console.error("Erro ao criar PPPoE:", erroPPPoE.message);
    }

    io.emit("cliente-criado", result.rows[0]);
    res.json({ ok: true, cliente: result.rows[0], pppoeCriado, pppoeErro });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});




app.get("/api/clientes/:id/acesso-remoto", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) {
      return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    }

    const cliente = r.rows[0];
    const acesso = await consultarIpPPPoECliente(cliente);

    res.json({
      ok: true,
      cliente_id: cliente.id,
      nome: cliente.nome,
      servidor: cliente.servidor,
      ...acesso
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function obterIpAtualCliente(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
  if (!usuario) throw new Error("Cliente sem usuário PPPoE.");

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const rows = parseRouterosRows(activeResp);
  const active = rows[0];

  if (!active || !active.address) {
    throw new Error("Cliente offline ou sem IP PPPoE ativo.");
  }

  return {
    ip: active.address,
    cfg,
    pppoe: usuario,
    uptime: active.uptime || "",
    caller_id: active["caller-id"] || ""
  };
}

async function fetchViaMikroTik(cfg, url) {
  const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/tool/fetch",
    `=url=${url}`,
    "=output=user",
    "=as-value="
  ]], 20000);

  const rows = parseRouterosRows(resp);
  const row = rows[0] || {};
  return row.data || row.contents || row["data"] || "";
}


app.get("/remoto/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).send("<h2>Cliente não encontrado.</h2>");

    const cliente = r.rows[0];
    const acesso = await obterIpAtualCliente(cliente);
    const alvo = `http://${acesso.ip}`;

    const html = await fetchViaMikroTik(acesso.cfg, alvo);

    if (!html || String(html).trim().length < 5) {
      return res.send(`
        <html><head><meta charset="utf-8"><title>Acesso Remoto</title></head>
        <body style="font-family:Arial;padding:30px">
          <h2>Acesso remoto localizado</h2>
          <p><b>Cliente:</b> ${cliente.nome || "--"}</p>
          <p><b>PPPoE:</b> ${cliente.pppoe || "--"}</p>
          <p><b>IP atual:</b> ${acesso.ip}</p>
          <p>O MikroTik alcança o equipamento, mas a página não retornou HTML pelo proxy.</p>
          <p>Esse proxy funciona melhor com páginas HTTP simples. Para interface completa com JavaScript, pode ser necessário VPN no técnico.</p>
        </body></html>
      `);
    }

    let conteudo = String(html);
    conteudo = conteudo.replace(/<head>/i, `<head><base href="/remoto/${req.params.id}/">`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(conteudo);
  } catch (error) {
    res.status(500).send(`
      <html><head><meta charset="utf-8"><title>Acesso Remoto</title></head>
      <body style="font-family:Arial;padding:30px">
        <h2>Erro no acesso remoto</h2>
        <p>${error.message}</p>
      </body></html>
    `);
  }
});

app.get("/api/clientes/:id/remoto-link", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const acesso = await obterIpAtualCliente(r.rows[0]);
    res.json({
      ok: true,
      ip: acesso.ip,
      pppoe: acesso.pppoe,
      link_proxy: `/remoto/${req.params.id}`,
      link_http_direto: `http://${acesso.ip}`
    });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.get("/api/clientes/:id/status-mikrotik", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) {
      return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    }

    const cliente = r.rows[0];
    const status = await consultarStatusMikroTik(cliente);

    res.json({ ok: true, cliente_id: cliente.id, servidor: cliente.servidor, ...status });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function consultarIpPPPoECliente(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
  if (!usuario) {
    return { online: false, ip: "", erro: "Cliente sem usuário PPPoE." };
  }

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const activeRows = parseRouterosRows(activeResp);
  const active = activeRows[0];

  if (!active) {
    return {
      online: false,
      ip: "",
      pppoe: usuario,
      mensagem: "Cliente não está online no PPPoE."
    };
  }

  return {
    online: true,
    ip: active.address || "",
    pppoe: usuario,
    uptime: active.uptime || "",
    caller_id: active["caller-id"] || ""
  };
}

app.get("/api/clientes/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function removerPPPoEDoServidor(cliente, servidorAntigo) {
  const clienteAntigo = { ...cliente, servidor: servidorAntigo };
  const cfg = servidorConfig(clienteAntigo.servidor);

  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik antigo não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
  if (!usuario) throw new Error("Cliente sem usuário PPPoE para migrar.");

  // Derruba sessão ativa se existir.
  try {
    const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/active/print",
      `?name=${usuario}`
    ]]);

    const activeRows = typeof parseRouterosRows === "function" ? parseRouterosRows(activeResp) : [];
    const activeId = activeRows.length ? (activeRows[0][".id"] || activeRows[0]["id"]) : "";

    if (activeId) {
      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/active/remove",
        `=.id=${activeId}`
      ]]);
    }
  } catch (e) {
    console.log("Sessão ativa não encontrada ou já desconectada:", usuario);
  }

  // Remove o secret do servidor antigo.
  try {
    await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/secret/remove",
      `=numbers=${usuario}`
    ]]);
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (!(msg.includes("no such") || msg.includes("not found") || msg.includes("does not"))) {
      throw e;
    }
  }

  return true;
}

async function migrarServidorCliente(clienteAntigo, clienteNovo) {
  const servidorAntigo = String(clienteAntigo.servidor || "").trim().toUpperCase();
  const servidorNovo = String(clienteNovo.servidor || "").trim().toUpperCase();

  if (!servidorAntigo || !servidorNovo || servidorAntigo === servidorNovo) {
    return { migrado: false, motivo: "Servidor não mudou" };
  }

  await removerPPPoEDoServidor(clienteAntigo, clienteAntigo.servidor);
  await criarPPPoEClienteComProfile(clienteNovo);

  return { migrado: true, de: clienteAntigo.servidor, para: clienteNovo.servidor };
}

app.put("/api/clientes/:id", async (req, res) => {
  try {
    const antesResult = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!antesResult.rows.length) return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });

    const clienteAntigo = antesResult.rows[0];
    const c = req.body;

    const result = await pool.query(
      `UPDATE clientes SET
        nome=$1, servidor=$2, cpf=$3, telefone=$4, cep=$5, endereco=$6, numero=$7,
        complemento=$8, bairro=$9, referencia=$10, plano=$11, pppoe=$12, acesso_remoto=$13, senha=$14,
        vencimento=$15, valor=$16, status=$17, observacoes=$18
       WHERE id=$19 RETURNING *`,
      [
        c.nome || "",
        c.servidor || "",
        c.cpf || "",
        c.telefone || "",
        c.cep || "",
        c.endereco || "",
        c.numero || "",
        c.complemento || "",
        c.bairro || "",
        c.referencia || "",
        c.plano || "",
        c.pppoe || "",
        c.acessoRemoto || c.acesso_remoto || "",
        c.senha || "",
        c.vencimento || "",
        c.valor || "",
        c.status || clienteAntigo.status || "ativo",
        c.observacoes || "",
        req.params.id
      ]
    );

    const clienteNovo = result.rows[0];

    let migracao = { migrado: false };
    let migracaoErro = null;

    const servidorMudou = String(clienteAntigo.servidor || "").trim().toUpperCase() !== String(clienteNovo.servidor || "").trim().toUpperCase();
    const pppoeMudou = String(clienteAntigo.pppoe || "").trim() !== String(clienteNovo.pppoe || "").trim();

    if (servidorMudou) {
      try {
        migracao = await migrarServidorCliente(clienteAntigo, clienteNovo);
      } catch (e) {
        migracaoErro = e.message;
        console.error("Erro na migração de servidor:", e.message);
      }
    } else if (pppoeMudou) {
      // Se mudou o usuário PPPoE no mesmo servidor, remove o antigo e cria o novo.
      try {
        await removerPPPoEDoServidor(clienteAntigo, clienteAntigo.servidor);
        await criarPPPoEClienteComProfile(clienteNovo);
        migracao = { migrado: true, motivo: "PPPoE alterado no mesmo servidor" };
      } catch(e) {
        migracaoErro = e.message;
      }
    }

    res.json({ ok: true, cliente: clienteNovo, migracao, migracaoErro });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.post("/api/clientes/:id/bloquear", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    await acaoPPPoECliente(cliente, "bloquear");
    const up = await pool.query("UPDATE clientes SET status='bloqueado', confianca_ate='' WHERE id=$1 RETURNING *", [req.params.id]);

    res.json({ ok:true, acao:"bloqueado", cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.post("/api/clientes/:id/desbloquear", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    await acaoPPPoECliente(cliente, "desbloquear");
    const up = await pool.query("UPDATE clientes SET status='ativo', confianca_ate='' WHERE id=$1 RETURNING *", [req.params.id]);

    res.json({ ok:true, acao:"desbloqueado", cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.post("/api/clientes/:id/confianca", async (req, res) => {
  try {
    const dias = Number(req.body.dias || 7);
    const ate = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    await acaoPPPoECliente(cliente, "desbloquear");
    const up = await pool.query("UPDATE clientes SET status='confianca', confianca_ate=$1 WHERE id=$2 RETURNING *", [ate, req.params.id]);

    res.json({ ok:true, acao:"confianca", confianca_ate:ate, cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.delete("/api/clientes/:id", async (req,res)=>{
  try { await pool.query("DELETE FROM clientes WHERE id=$1",[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({ok:false, erro:e.message}); }
});


app.get("/api/mikrotik/test", async (req, res) => {
  try {
    const servidor = req.query.servidor || "COLONIA ANTONIO ALEIXO";
    const cfg = servidorConfig(servidor);
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({ ok: false, erro: "Variáveis do MikroTik não configuradas", servidor: cfg.key });
    }

    const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/system/identity/print"]]);
    res.json({ ok: true, servidor: cfg.key, host: cfg.host, resposta });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function consultarOnlineServidor(nomeServidor) {
  const cfg = servidorConfig(nomeServidor);

  if (!cfg.host || !cfg.user || !cfg.pass) {
    return {
      ok: false,
      servidor: cfg.key,
      erro: "Variáveis do MikroTik não configuradas para " + cfg.key,
      clientes: []
    };
  }

  try {
    const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/active/print"
    ]], 15000);

    const rows = parseRouterosRows(resp).map((c) => ({
      name: c.name || "",
      usuario: c.name || "",
      address: c.address || "",
      ip: c.address || "",
      callerId: c["caller-id"] || "",
      uptime: c.uptime || "",
      service: c.service || "",
      servidor: cfg.key
    }));

    return {
      ok: true,
      servidor: cfg.key,
      total: rows.length,
      clientes: rows
    };
  } catch (error) {
    return {
      ok: false,
      servidor: cfg.key,
      erro: error.message,
      clientes: []
    };
  }
}

app.get("/api/online", async (req, res) => {
  try {
    const [armando, colonia] = await Promise.all([
      consultarOnlineServidor("ARMANDO"),
      consultarOnlineServidor("COLONIA")
    ]);

    const clientes = [
      ...(armando.clientes || []),
      ...(colonia.clientes || [])
    ];

    res.json({
      ok: armando.ok || colonia.ok,
      atualizadoEm: new Date().toISOString(),
      total: clientes.length,
      servidores: {
        armando,
        colonia
      },
      clientes
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      erro: error.message
    });
  }
});

app.get("/api/pppoe/online", async (req, res) => {
  return app._router.handle(req, res, () => {});
});


io.on("connection",(socket)=>{
  socket.emit("hub-update", geral());
  socket.emit("mikrotik-update", geral());
});

const PORT=process.env.PORT || 3000;

// Na Vercel, o Express precisa ser exportado como função serverless.
// Fora da Vercel, continua rodando normal com npm start.
if (process.env.VERCEL) {
  initDb().catch(err => console.error("Erro ao iniciar banco:", err.message));
  module.exports = app;
} else {
  initDb().finally(() => server.listen(PORT, () => console.log("Fibra+ Hub 2 Servidores rodando na porta " + PORT)));
}

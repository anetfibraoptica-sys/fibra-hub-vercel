# FIBRA+ HUB — Atualização visual 2026

Esta versão adiciona uma nova camada visual em `public/fibra-theme-2026.css`.

## O que foi alterado
- Sidebar e navegação com visual corporativo azul escuro.
- Topbar com efeito translúcido e badges compactos.
- Cards, painéis e tabelas com hierarquia visual mais clara.
- Inputs, selects, botões e estados de foco padronizados.
- Cadastro, resumo do cliente, lista de clientes e Financeiro/Efí harmonizados.
- Login redesenhado.
- Melhorias para desktop e celular.
- Mantido suporte ao modo claro já existente.

## Segurança da mudança
A atualização é aditiva: os HTMLs apenas carregam o novo CSS depois do `style.css` existente. IDs, `onclick`, scripts, chamadas de API, Supabase, Efí, MikroTik e regras de negócio não foram renomeados nem removidos.

Para reverter apenas o visual, basta remover a linha que carrega `fibra-theme-2026.css` dos HTMLs.

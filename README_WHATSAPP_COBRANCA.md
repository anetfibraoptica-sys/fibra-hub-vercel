# Cobrança por WhatsApp — Fibra+ Hub

Este módulo adiciona, no menu **Financeiro Efí**, o botão **Cobrar todos por WhatsApp** por uma data de vencimento específica.

## O que ele faz

- Lê os boletos já existentes no banco para a data escolhida.
- Não cria, não altera e não cancela boletos.
- Ignora cobranças pagas/canceladas.
- Ignora clientes cancelados/inativos e clientes marcados como isentos/não cobrar.
- Ignora clientes sem telefone válido.
- Agrupa mais de um boleto do mesmo cliente na mesma data e soma o valor pendente.
- Mostra uma prévia antes do envio.
- Exige confirmação antes do disparo.
- Registra cada tentativa na tabela `whatsapp_cobrancas`.
- Evita envio duplicado para o mesmo cliente/vencimento no mesmo dia.
- Em caso de erro, permite tentar novamente.

## Integração usada

O envio automático usa a **WhatsApp Cloud API oficial da Meta**, no modo de **template aprovado**.

Configure estas variáveis no ambiente do servidor/Vercel:

- `WHATSAPP_CLOUD_TOKEN`
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_TEMPLATE_NAME`
- `WHATSAPP_CLOUD_TEMPLATE_LANGUAGE` (opcional; padrão `pt_BR`)
- `WHATSAPP_CLOUD_API_VERSION` (opcional; padrão `v23.0`)
- `APP_TIMEZONE` (opcional; padrão `America/Manaus`)

## Template esperado

O template deve possuir três variáveis no corpo, nesta ordem:

1. Primeiro nome do cliente
2. Data de vencimento
3. Valor pendente

Exemplo do texto a aprovar como template de utilidade:

`Olá, {{1}}. Sua mensalidade Fibra+ com vencimento em {{2}} está pendente. Valor: {{3}}. Caso já tenha pago, desconsidere esta mensagem.`

O nome real do template aprovado deve ser informado em `WHATSAPP_CLOUD_TEMPLATE_NAME`.

## Endpoints adicionados

- `GET /api/whatsapp/cobranca/status`
- `GET /api/whatsapp/cobranca/preview?vencimento=AAAA-MM-DD`
- `POST /api/whatsapp/cobranca/enviar`

O envio exige sessão do painel e permissão `financeiro`.

## Segurança operacional

O botão de envio fica desabilitado até a API estar configurada e até uma prévia ser carregada. O servidor limita cada disparo a no máximo 200 clientes e processa em pequenos lotes concorrentes.

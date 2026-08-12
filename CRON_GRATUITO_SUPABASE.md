# Cron gratuito das confianças

1. Faça o deploy normal na Vercel Hobby.
2. Confirme que a variável `CRON_SECRET` continua configurada na Vercel.
3. Entre no painel como usuário com permissão de Configurações.
4. Abra `/cron-gratuito.html` no mesmo domínio do painel.
5. Clique em **Ativar rotina gratuita**.

O backend habilita `pg_cron` e `pg_net` no Supabase, guarda a URL e o token no Vault e agenda a chamada de `/api/cron/confiancas` a cada minuto.

O cron diário de bloqueios gerais continua na Vercel às 05:00 no horário de Fortaleza. A checagem de confianças vencidas passa a ser executada pelo Supabase.

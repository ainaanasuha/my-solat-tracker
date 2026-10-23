# My Solat Tracker — Shared Edition

Versi ini menggunakan Supabase Auth dan jadual shared yang telah disediakan melalui SQL Editor. Kedua-dua akaun perlu wujud dalam Authentication → Users dan kedua-dua User ID perlu dimasukkan ke `public.tracker_members`.

## Fail penting
- `index.html`, `style.css`, `app.js`: aplikasi web.
- `config.example.js`: contoh konfigurasi Supabase.
- `supabase-shared.sql`: rujukan skema SQL (jangan jalankan semula jika jadual telah dibuat).
- `vercel.json`: konfigurasi ringkas hosting.

## 1. Sambungkan Supabase
1. Salin `config.example.js` dan namakan salinan itu `config.js`.
2. Dalam Supabase, buka Project Settings → API (atau API Settings).
3. Salin **Project URL** ke `SUPABASE_URL`.
4. Salin **anon/public key** ke `SUPABASE_ANON_KEY`.
5. Jangan gunakan atau dedahkan `service_role` key. Jangan kongsi password akaun.
6. Buka `index.html` dalam browser untuk ujian ringkas, atau deploy fail-fail ini ke hosting.

## 2. Pengguna
Buat akaun dalam Supabase → Authentication → Users. Masukkan setiap User UID ke `tracker_members` melalui SQL Editor. Aplikasi ini menggunakan log masuk email/password dan tidak mempunyai borang daftar akaun awam.

## 3. Deploy
Muat naik folder projek ke GitHub dan import repository itu ke Vercel, atau gunakan cara deployment statik yang anda biasa gunakan. Pastikan `config.js` turut disediakan semasa deployment. Jangan letak `service_role` key dalam fail browser.

## Nota
- Semua pengguna dalam `tracker_members` berkongsi rekod solat dan refleksi yang sama.
- RLS menghadkan akses jadual kepada ahli yang didaftarkan.
- Skema ini tidak menyediakan fungsi memadam rekod dalam aplikasi.
- Untuk perubahan status, aplikasi menyimpan terus ke database; pastikan login berjaya.

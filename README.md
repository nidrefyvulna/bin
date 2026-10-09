# Panel IoT — versi bisa Tambah Perangkat

Update dari versi sebelumnya: sekarang kamu bisa **menambah/menghapus perangkat** langsung dari tampilan, tidak lagi harus di-hardcode di kode.

## Yang baru

- Tombol **"+ Tambah Perangkat"** di atas grid perangkat.
- Dua jenis perangkat yang bisa ditambah:
  - **Sensor** → tampil sebagai gauge (isi: nama, topic, satuan, nilai min/max). Contoh: suhu ruang tamu, level air tandon, kualitas udara, dst.
  - **Saklar** → tampil sebagai toggle ON/OFF (isi: nama, topic status, topic perintah). Contoh: lampu teras, pompa air, kipas, dst.
- Tombol **×** kecil di pojok tiap kartu untuk menghapus perangkat itu.
- Semua perangkat otomatis tersimpan di browser (localStorage) — tetap ada walau halaman ditutup.
- Panel **Pengaturan Koneksi** sekarang cuma berisi info broker (URL, Client ID, user/pass) — topic sudah pindah ke tiap kartu perangkat.

## Cara tambah perangkat baru

1. Klik **"+ Tambah Perangkat"**.
2. Pilih tipe: **🌡️ Sensor** atau **💡 Saklar**.
3. Isi nama, ikon (emoji, opsional), dan topic sesuai firmware ESP32 kamu.
   - Untuk Sensor, isi juga satuan serta nilai minimum/maksimum (dipakai buat skala gauge-nya saja, bukan validasi data).
   - Untuk Saklar, isi topic **status** (yang di-dengarkan) dan topic **perintah** (yang dikirim saat toggle diklik).
4. Klik **Tambah Perangkat**. Kartu baru langsung muncul di grid, dan otomatis di-subscribe kalau sedang terhubung ke broker.

## Cara pakai selebihnya

Sama seperti sebelumnya: buka status di kanan atas untuk atur koneksi broker, "Simpan & Hubungkan" untuk konek beneran, atau "Coba Mode Simulasi" untuk lihat tampilan bergerak tanpa broker.

## Struktur file

```
index.html   → struktur halaman (device grid dikosongkan, diisi oleh script.js)
style.css    → tampilan panel + kartu perangkat dinamis
script.js    → penyimpanan perangkat, koneksi MQTT, render kartu, gauge & toggle
```

Bisa dipasangkan langsung dengan firmware/simulasi Wokwi yang sudah dibuat sebelumnya — topic default (`rumah/kamar1/...`) tetap sama persis.

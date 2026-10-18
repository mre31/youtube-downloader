# YouTube Downloader

Next.js tabanlı video ve ses indirme uygulaması. Docker imajı Node.js 24, Python,
FFmpeg ve EJS bileşenleriyle birlikte yt-dlp içerir; root olmayan kullanıcıyla çalışır.

## Portainer ile kurulum

Bu yapılandırma **Docker Standalone** ortamı içindir.

### Git repository üzerinden

1. Bu dosyaları Git reponuza gönderin.
2. Portainer'da Docker ortamını açıp **Stacks → Add stack → Repository / Git repository** seçin.
3. Repo adresini (`https://github.com/mre31/youtube-downloader`) ve değişikliklerin bulunduğu branch'i girin.
4. **Compose path** alanına `compose.yml` yazın.
5. İsteğe bağlı olarak **Environment variables** altında `APP_PORT` tanımlayın. Varsayılan: `5055`.
6. **Deploy the stack** ile imajı derleyip uygulamayı başlatın.

Uygulamaya `http://SUNUCU_IP:5055` üzerinden ulaşabilirsiniz. `APP_PORT` değiştirildiğinde
adresteki portu da değiştirin. İlk dağıtım, bağımlılıklar indirildiği ve Next.js derlendiği için zaman alabilir.

### Web editor / Upload üzerinden

Bu yöntemde `portainer-stack.yml` kullanılır. Önce imajı **Portainer'ın yönettiği Docker
sunucusunda** repo klasöründen derleyin:

```bash
docker build -t youtube-downloader:local .
```

Portainer'da **Stacks → Add stack → Web editor** alanına `portainer-stack.yml` içeriğini
yapıştırın veya **Upload** ile dosyayı yükleyip dağıtın.

İmajı başka makinede derliyorsanız bir container registry'ye gönderin ve Portainer'da
`APP_IMAGE` değişkenini tam imaj adına ayarlayın (ör. `ghcr.io/kullanici/youtube-downloader:latest`).
Özel registry için Portainer'a registry erişimini de ekleyin.

Portainer'ın dağıtım yöntemleri: [resmî stack dokümanı](https://docs.portainer.io/user/docker/stacks/add).

## Docker Compose ile yerel kullanım

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f
```

`.env` içindeki `APP_PORT` dış portu, `APP_IMAGE` imaj adını belirler. Container içindeki
port her zaman `5055` olarak kalır. Varsayılan adres: `http://localhost:5055`.

```bash
docker compose down
```

## İşletim ve güncelleme

- `/api/health` uç noktası Docker sağlık kontrolü için kullanılır. Container çökerse
  `unless-stopped` yeniden başlatma politikası devreye girer. `unhealthy` durumu tek
  başına Docker tarafından yeniden başlatma tetiklemez.
- Geçici indirmeler `downloads` isimli Docker volume'ünde tutulur. Uygulama başlangıçta
  eski dosyaları temizler; bu volume bir indirme arşivi değildir.
- İndirme işlerinin durumu bellekte tutulur. **Tek replica** çalıştırın; yeniden başlatmada
  devam eden işler kaybolur ve kullanıcıların indirmeyi tekrar başlatması gerekir.
- yt-dlp imaj derlenirken kurulur. Güncellemek için repo klasöründe aşağıdaki komutu
  Portainer'ın yönettiği Docker sunucusunda çalıştırın; ardından Portainer stack'ini
  güncel imajla yeniden dağıtın. Registry kullanıyorsanız yeni imajı gönderip yeniden çekin.

  ```bash
  docker compose build --pull --no-cache
  ```

- Domain/HTTPS için reverse proxy hedefi uygulamanın `5055` portudur. Büyük indirmeler
  için proxy zaman aşımını yeterince uzun tutun ve indirme yanıtlarında buffering'i kapatın.
- Derleme sırasında npm, Python paket deposu ve Google Fonts'a; indirme sırasında
  YouTube'a ağ erişimi gerekir. YouTube'un sunucu IP'sine uyguladığı bot doğrulaması
  indirmeleri engelleyebilir.

## Geliştirme

Node.js 24 ve Python 3 kullanın:

```bash
npm ci
npm run dev
```

Adres: `http://localhost:5055`. Docker dışında yt-dlp ilk kullanımda `bin/` altına
indirilir ve uygulama tarafından güncellenir. `YT_DLP_PATH` tanımlanırsa belirtilen
çalıştırılabilir dosya kullanılır, otomatik güncelleme yapılmaz. `FFMPEG_BIN` ile sistem
FFmpeg yolu belirtilebilir; Docker imajında `/usr/bin/ffmpeg` kullanılır.

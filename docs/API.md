# Dış API kullanımı

Temel adres: `http://localhost:5055` (sunucuda kendi domain/IP adresiniz).
API, uygulamanın kendi yt-dlp altyapısını kullanır; üçüncü taraf API aboneliği gerekmez.
Node.js 24 + Python veya README'deki Docker kurulumunu kullanın; erişim için aşağıdaki token kurulumunu yapın.

## Token kurulumu

Sunucuda `.env` dosyasına `API_TOKEN` tanımlayın. Örnek dosyayı kopyalayıp
`openssl rand -hex 32` ile ürettiğiniz uzun rastgele değeri yazabilirsiniz:

```dotenv
API_TOKEN=BURAYA_URETTIGINIZ_TOKEN
```

Docker/Portainer'da `API_TOKEN` ortam değişkenini tanımlayıp container'ı yeniden
oluşturun. Yerel geliştirmede değişiklikten sonra sunucuyu yeniden başlatın.
Token `NEXT_PUBLIC_` değişkenine yazılmaz ve istemci JavaScript paketine eklenmez.

İstek gönderdiğiniz terminalde de aynı token'ı `API_TOKEN` olarak tanımlayın.
Tüm v1 uçları, dosya ve durum sorguları dahil, şu başlığı zorunlu tutar:

```http
Authorization: Bearer TOKENINIZ
```

Token URL/query parametresinde veya JSON gövdesinde kabul edilmez. Eksik veya
hatalı token `401`, sunucuda tanımlanmamış token `503` döndürür. Kimlik doğrulama,
metadata sorgusu ve indirme başlamadan önce yapılır. **Hız sınırı uygulanmaz.**
HTTPS üzerinden kullanın. Token'ı değiştirmek için sunucudaki `API_TOKEN` değerini
güncelleyip uygulamayı yeniden başlatın; eski token ve tarayıcı oturumları geçersizleşir.

Arayüz ilk açılışta token ister. Girişte `/api/auth` ucuna Bearer token gönderilir;
8 saat geçerli, imzalı, `HttpOnly`, `SameSite=Strict` oturum çerezi oluşturulur.
HTTPS isteklerinde çerez `Secure` olarak işaretlenir. HTTPS reverse proxy kullanırken
`X-Forwarded-Proto: https` başlığının doğru iletildiğinden emin olun. Token tarayıcıda
localStorage/sessionStorage'a yazılmaz; girişten sonra formdaki değer temizlenir.
Arayüzde “Çıkış yap” çerezi siler. Oturum çerezi yalnızca eski arayüz API'lerinde
kullanılır; `/api/v1` her zaman Bearer başlığı ister. `/api/health` token istemez.

## Hızlı başlangıç

Yalnızca video bağlantısı gönderin. Başlık ve format bilgisi otomatik bulunur:

```bash
curl --fail-with-body -X POST http://localhost:5055/api/v1/downloads \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
```

Yanıt `202 Accepted` olur; bu, indirme işinin oluşturulduğunu belirtir.
Video bilgisi sorgusu bu istek içinde yapılır, bu nedenle ilk yanıt birkaç saniye sürebilir.
Örnek yanıt (formatlar videoya göre değişir):

```json
{
  "id": "JOB_ID",
  "status": "downloading",
  "title": "Video başlığı",
  "format": {
    "formatId": "137+140",
    "ext": "mp4",
    "resolution": "1080p",
    "qualityLabel": "1080p (MP4)",
    "filesize": null,
    "vcodec": "avc1.640028",
    "acodec": "mp4a.40.2",
    "fps": 30,
    "tbr": 2000
  },
  "statusUrl": "/api/v1/downloads/JOB_ID",
  "fileUrl": "/api/v1/downloads/JOB_ID/file"
}
```

`Location` başlığı durum yolunu, `Retry-After: 2` önerilen sorgulama aralığını verir.
Dönen yollar temel adrese göreli yollardır; kendi temel adresinize ekleyin.

```bash
# Yaklaşık 2 saniyede bir sorgulayın.
curl --fail-with-body -H "Authorization: Bearer $API_TOKEN" http://localhost:5055/api/v1/downloads/JOB_ID

# status=completed olduğunda dosyayı alın.
# Uzantıyı ilk yanıttaki format.ext değerine göre seçin.
curl --fail-with-body -H "Authorization: Bearer $API_TOKEN" http://localhost:5055/api/v1/downloads/JOB_ID/file -o video.mp4
```

Tüm akışı otomatik yapan, ek paket gerektirmeyen örnek (`API_TOKEN` ortam değişkeni zorunludur):

```bash
node examples/download.mjs 'https://youtu.be/jNQXAC9IVRw' video.bin
node examples/download.mjs 'https://youtu.be/jNQXAC9IVRw' video.bin --max-height=720
node examples/download.mjs 'https://youtu.be/jNQXAC9IVRw' audio.bin --audio
API_BASE_URL=https://indir.example.com node examples/download.mjs 'https://youtu.be/jNQXAC9IVRw' video.bin
```

Dosya özgün biçiminde kaydedilir; `.bin` yalnızca örnek dosya adıdır. Gerçek kapsayıcı
`format.ext` alanındadır. Betik mevcut dosyanın üzerine yazmaz, 30 dakika sonunda beklemeyi
bırakır. İstemcinin beklemeyi bırakması sunucudaki işi iptal etmez.

## Uç noktalar

| Metot | Yol | İşlev |
| --- | --- | --- |
| POST | `/api/v1/videos/info` | Video bilgisi ve özgün format listesi |
| POST | `/api/v1/downloads` | Yeni indirme işi; başarılı yanıt 202 |
| GET | `/api/v1/downloads/{id}` | İndirme durumu; başarılı yanıt 200 |
| GET | `/api/v1/downloads/{id}/file` | Tamamlanan dosya; başarılı yanıt 200 |
| GET | `/api/health` | Sağlık kontrolü |

POST isteklerinde `Content-Type: application/json` kullanın.

### İndirme seçenekleri

| Alan | Tür | Varsayılan / açıklama |
| --- | --- | --- |
| `url` | string, zorunlu | Tek YouTube videosu: watch, youtu.be, shorts, embed veya live bağlantısı |
| `type` | `video` veya `audio` | `video` |
| `maxHeight` | integer | İsteğe bağlı, 1–8640; yalnızca video için üst çözünürlük sınırı |
| `formatId` | string | İsteğe bağlı; bilgi ucundan alınan özgün format kimliği |
| `ext` | string | `formatId` ile birlikte zorunlu; aynı formatın kapsayıcısı |

Bilinmeyen alanlar reddedilir. Varsayılan video seçimi en yüksek çözünürlük, ardından
kare hızı ve bit hızına göredir. Ses seçimi en yüksek kaynak bit hızına göredir;
codec'ler arasındaki bit hızı sıralaması algılanan ses kalitesi garantisi değildir.
`maxHeight: 720` en fazla 720p olan mevcut en iyi seçeneği indirir; çözünürlük büyütülmez.
Hiçbir seçenek eşleşmezse `422` döner. Playlist indirilmez; watch bağlantısındaki `list`
parametresi kaldırılır. Canlı yayının ne zaman biteceği kaynağa bağlıdır.

```json
{"url":"https://youtu.be/jNQXAC9IVRw","type":"video","maxHeight":720}
```

```json
{"url":"https://youtu.be/jNQXAC9IVRw","type":"audio"}
```

**Yeniden kodlama yoktur.** Video/ses gerekirse stream-copy ile birleştirilir.
Ses M4A, WebM/Opus gibi kaynağın sunduğu biçimde gelir. MP3 dönüşümü yapılmaz.
Video kapsayıcısı MP4, WebM veya MKV olabilir; her zaman `format.ext` değerini okuyun.

### Formatı kendiniz seçme

```bash
curl --fail-with-body -X POST http://localhost:5055/api/v1/videos/info \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/jNQXAC9IVRw"}'
```

Yanıt: `id`, `url`, `title`, `thumbnail`, `duration` (saniye), `author`, `formats`.
`formats` elemanları `formatId`, `ext`, `resolution`, `qualityLabel`, `filesize`
(bayt veya `null`), `vcodec`, `acodec`, isteğe bağlı `fps` ve `tbr` (kbps) içerir.
Ses için `resolution: "Audio"`, `vcodec: "none"` kullanılır.

Listeden aldığınız `formatId` ve `ext` değerlerini birlikte gönderin:

```json
{"url":"https://youtu.be/jNQXAC9IVRw","type":"video","formatId":"137+140","ext":"mp4"}
```

Bu kimlikler örnektir; her videoda bulunmayabilir. Ses formatı seçerken `type: "audio"`
gönderin. Sunucu, seçimin o videonun mevcut formatları arasında olduğunu doğrular.

### Durum yanıtı

```json
{
  "id": "JOB_ID",
  "status": "completed",
  "progress": 100,
  "speed": "1.90MiB/s",
  "eta": "00:00",
  "filename": "Video.mp4",
  "error": null,
  "fileUrl": "/api/v1/downloads/JOB_ID/file"
}
```

`status`: `downloading`, `merging`, `completed` veya `failed`.
`fileUrl` tamamlanmadan önce `null` olur. İlerleme ayrı video/ses akışlarına aittir;
yeni akışa geçerken azalabilir. Hız ve kalan süre gösterim amaçlı metinlerdir.
`failed` durumunda `error`, `{ "code": "DOWNLOAD_FAILED", "message": "..." }` olur;
istemci sorgulamayı sonlandırmalıdır. Ayrıntılar sunucu loglarındadır.

Dosya yanıtı `application/octet-stream`, `Content-Length` ve indirme adını içeren
`Content-Disposition` başlıklarıyla akış olarak gönderilir. Range/resume desteklenmez;
bağlantı kesilirse dosyanın tamamını yeniden isteyin.

## Hatalar

v1 hata yanıtları aynı yapıyı kullanır:

```json
{"error":{"code":"INVALID_URL","message":"Only YouTube video URLs are supported."}}
```

| HTTP | Kod | Anlam |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Bearer token eksik veya yanlış |
| 503 | `AUTH_NOT_CONFIGURED` | Sunucuda `API_TOKEN` tanımlanmamış |
| 400 | `INVALID_JSON`, `INVALID_URL`, `INVALID_OPTIONS` | İstek içeriğini düzeltin |
| 404 | `JOB_NOT_FOUND` | İş yok, silinmiş veya sunucu yeniden başlamış |
| 409 | `FILE_NOT_READY` | Dosya henüz hazır değil veya iş başarısız |
| 410 | `FILE_EXPIRED` | İş biliniyor ancak dosya temizlenmiş; yeni iş başlatın |
| 422 | `FORMAT_UNAVAILABLE` | İstenen özgün format veya çözünürlük bulunamadı |
| 502 | `UPSTREAM_ERROR` | Kaynak/yt-dlp/sunucu işleme hatası; sunucu loglarını kontrol edin |

## Yayınlama ve çalışma sınırları

- API, uygulamayla aynı porttan erişilir. Docker/Portainer kurulum adımları README'dedir.
- Hem eski hem yeni API uçları token/oturum doğrulamasıyla korunur. Paylaşılan tek
  `API_TOKEN` kullanılır; kullanıcı başına ayrı yetki veya iş sahipliği yoktur. Aynı
  token'a sahip istemciler iş kimliği üzerinden dosyalara erişebilir. Hız sınırı yoktur.
- Sunucudan sunucuya HTTP çağrıları doğrudan kullanılabilir. Farklı origin'deki tarayıcı
  uygulamaları için CORS başlıkları eklenmez; kendi backend'iniz veya aynı origin proxy'si
  üzerinden çağırın ve API token’ını backend ortam değişkeninde saklayın.
- İşler bellekte, dosyalar geçici diskte tutulur. Tek replica ve uzun süre çalışan
  Node.js/Docker sunucusu kullanın. Kısa ömürlü serverless ortam uygun değildir.
  Yeniden başlatma iş kayıtlarını kaybettirir. Her POST yeni iş oluşturur;
  otomatik tekrarlar aynı videoyu tekrar indirebilir.
- Tamamlanan/başarısız işler ve tamamlanan dosyalar yaklaşık 10–15 dakika içinde
  temizlenir (10 dakika saklama, 5 dakika temizlik aralığı). Dosyayı tamamlanınca alın.
  Dosyayı almak saklama süresini uzatmaz; bağlantı kesilmesi dosyayı hemen silmez.
- YouTube bot doğrulaması, erişim kısıtlamaları ve formatların değişmesi indirmeyi
  engelleyebilir. Proxy zaman aşımını ilk metadata sorgusu ve büyük dosya aktarımına
  göre ayarlayın; dosya yanıtlarında buffering'i kapatın.
- Arayüzün `/api/info` ve `/api/download/*` uçları korunur. Yeni entegrasyonlarda
  sürümlü `/api/v1` uçlarını kullanın; eski uçların yanıt biçimi farklıdır.

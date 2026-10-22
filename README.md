# Vision Window: מסע בזמן במציאות רבודה

אב-טיפוס עובד של Vision Window לפי מסמך האפיון (MVP 1.0.0). האפליקציה מציגה את כיכר השעון ביפו בחמש תקופות: 1880, 1920, 1970, 2026 ו-2050. סרגל הזמן מעביר בין התקופות, ועדשת רנטגן חושפת את העבר בתוך ההווה.

> הכיכר משוחזרת באופן פרוצדורלי לצורכי הדגמה. זה לא מודל היסטורי מדויק.

## מה יש בפנים

| תחום באפיון | מה מומש | איפה |
|---|---|---|
| מנוע תלת-ממד (WebGL / Three.js) | סצנה מלאה לכל תקופה: מבנים, קרקע, תאורה, שמיים | `client/index.html` |
| סרגל זמן פיזי | סרגל 1880–2050 עם רטט (Haptic) בכל עשור ובמעבר תקופה, ומעבר רך בין סצנות | `client/index.html` |
| עדשת רנטגן | עדשה עגולה שאפשר לגרור, לצבוט ולשנות את גודלה בגלגלת. בתוכה העבר, ומחוצה לה ההווה או המצלמה האמיתית | shader קומפוזיציה |
| שכבות | מבנים, דמויות, תחבורה, אווירה | |
| NPCs ותנועה | הולכי רגל עם אנימציית שלד פרוצדורלית, כרכרות עם סוסים, מכוניות, אוטובוסים ורכבים מרחפים | `World.update` |
| Pathfinding | מעקב אחר Waypoints, הימנעות ממכשולים (מגדל השעון, עצים, פנסים), הפרדה בין דמויות, ורכבים ששומרים מרחק ונעצרים להולך רגל | |
| אטמוספירה | מחזור יום/לילה לפי שעה (גם השעון במגדל מראה אותה), שמש, כוכבים, חלונות ופנסים שנדלקים בלילה, ערפל וגשם | `applyEnvironment` |
| LOD 0/1/2 | שלוש רמות פירוט לכל מבנה לפי מרחק, לפי הספים שבאפיון (10 ו-50 מטר) | `makeBuilding` |
| 60FPS | רזולוציה אדפטיבית, איחוד גיאומטריה סטטית, וצללים כבויים בנייד | לולאת `frame` |
| חיישנים ומצלמה | מצלמה אחורית (getUserMedia) כשכבת ההווה, וג'ירוסקופ (DeviceOrientation) לסיבוב 3DoF | |
| שרת GIS | PostgreSQL + PostGIS לפי סכמת הנתונים שבאפיון, עם שאילתות מרחביות לפי GPS ורדיוס | `server/` |
| Streaming Engine | WebSocket ‏`/ws`: הלקוח שולח מיקום ושנה, והשרת דוחף מניפסט נכסים פעם אחת לכל אתר ותקופה (Geofencing) | `server/src/stream.js` |

### מה עוד לא מומש

אלה החלקים באפיון שדורשים חומרה, מודלים או תשתית שלא היו זמינים לאב-טיפוס:

- **אפליקציה נייטיב (React Native, ARKit/ARCore, 6DoF מלא):** הלקוח הנוכחי הוא אפליקציית ווב. ההליכה במרחב נעשית בג'ויסטיק או ב-WASD, והסיבוב בגרירה או בג'ירוסקופ.
- **VPS (מיקום ויזואלי):** אין שירות VPS, ולכן המיקום מדומה ומוצג בלוח הביצועים כ-`manual (no VPS)`.
- **מודלי GLTF עם דחיסת Draco:** כל הגיאומטריה נוצרת פרוצדורלית. השדה `model_url` מצביע ל-`procedural://...` עד שיהיו מודלים אמיתיים.
- **AI Inpainting (Stable Diffusion):** לא מומש.

## הרצה

### רק הלקוח, בלי שרת

```bash
cd client && python3 -m http.server 8000
# http://localhost:8000
```

הלקוח טוען את `client/data/jaffa-demo.json`.

### מערכת מלאה (PostGIS + API + לקוח)

```bash
docker compose up --build
# http://localhost:8080
```

השרת מריץ migrations, טוען את אותו מאגר נתונים ל-PostGIS, ומגיש את הלקוח. הלקוח מזהה שה-API זמין ועובר לטעון ממנו (בלוח "ביצועים" יופיע `data: PostGIS API`).

בלי Docker:

```bash
cd server
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/vision_window   # דורש PostGIS
npm run migrate && npm run seed && npm start
```

### בדיקות

```bash
cd server
npm test        # עם DATABASE_URL מוגדר רצות גם בדיקות האינטגרציה מול PostGIS
```

## API

| נתיב | תיאור |
|---|---|
| `GET /api/health` | בדיקת חיים וגרסת PostGIS |
| `GET /api/locations/nearby?lat&lng&radius` | אתרים ברדיוס (מטרים), ממוינים לפי מרחק (`ST_DWithin` על geography) |
| `GET /api/locations/:id/assets?year&lod` | נכסים תלת-ממדיים שתקפים לשנה נתונה |
| `GET /api/locations/:id/paths?year` | מסלולי תנועה של התקופה כ-GeoJSON, כולל אורך במטרים |
| `GET /api/locations/:id/timeline` | כל התקופות במבנה שהלקוח צורך |
| `WS /ws` | שולחים `{type:"pose", lat, lng, year}` ומקבלים `{type:"manifest", ...}` |

## שליטה

| פעולה | מחשב | טלפון |
|---|---|---|
| הסתכלות | גרירה | גרירה או כפתור "חיישנים" |
| הליכה | WASD או החצים (Shift לריצה) | ג'ויסטיק |
| הזזת העדשה | גרירה בתוך העדשה | גרירה בתוך העדשה |
| גודל העדשה | גלגלת | צביטה |
| קפיצה בעשור | `[` / `]` | סרגל הזמן |
| הפעלה וכיבוי של העדשה | `L` | כפתור "עדשת רנטגן" |

## מבנה הריפו

```
client/                 אפליקציית הווב (קובץ HTML אחד + Three.js מ-CDN)
  data/jaffa-demo.json  מאגר נתוני הדמו, משותף ללקוח ול-seed של השרת
server/
  db/schema.sql         סכמת PostGIS מהאפיון
  db/seed.js            טעינת מאגר הדמו לבסיס הנתונים
  src/app.js            Express API
  src/stream.js         WebSocket streaming עם Geofencing
  test/                 בדיקות יחידה ואינטגרציה
docker-compose.yml      PostGIS + שרת
.github/workflows/      CI (בדיקות מול PostGIS) ופריסה ל-GitHub Pages
```

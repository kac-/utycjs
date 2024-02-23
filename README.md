installation:

```bash
npm add github:kac-/utycjs
```

usage:

```javascript
const ut = require("utycjs")

ut.load_solar_system().then(sys => {
  let names = sys.map_names()

  // unix timestamp (in seconds)
  let ts = 0
  // or 
  // WARNING: Date.UTC month is ZERO based, 5 is June
  ts = Date.UTC(2024, 5, 21, 12) / 1000
  // or
  ts = Date.now() / 1000
  // add 100 years
  ts += 60 * 60 * 24 * 365 * 100

  sys.set_time(ut.ts_to_pos(ts))
  console.log(names["Earth"].pos().toString())
  console.log(names["Mars"].pos().toString())
})
```

const m = require("mathjs")

const au = 149_597_870_700
const pi = m.pi

const cos = Math.cos
const sin = Math.sin

earth_tilt = [0, (23 + 26 / 60 + 14 / 3600) * pi / 180, 0]

yearLength = 365.2425
earthRotations = 366.2425
sDay = 1 / yearLength
sYear = sDay * 365
sMonth = sDay * 30
sWeek = sDay * 7
sHour = sDay / 24
sMinute = sHour / 60
sSecond = sMinute / 60

// WARNING: Date.UTC takes monthIndex (zero based)
// 05 is June
zero_timestamp = Date.UTC(2000, 5, 21, 12, 0) / 1000
zero_datetime = new Date(zero_timestamp)

function ts_to_pos(ts) {
  return (ts - zero_timestamp) * sSecond
}

function pos_to_ts(pos) {
  return pos / sSecond + zero_timestamp
}

//# seconds in standard day (24h)
sec_in_std_day = 86400

//# julian day to unix timestamp
function jd_to_ts(jd) {
  return (jd - 2440587.5) * sec_in_std_day
}

//# unix timestamp to julian day
function ts_to_jd(ts) {
  return ts / sec_in_std_day + 2440587.5
}

function rad(v) {
  return v * pi / 180
}

const ZE = m.matrix([0, 0, 0, 1])

//# from https://en.wikipedia.org/wiki/Rotation_matrix
function rotate_xyz(xyz) {
  let [x, y, z] = xyz.slice(0, 3)
  let mx = m.matrix([
    [cos(y) * cos(z), sin(x) * sin(y) * cos(z) - cos(x) * sin(z), cos(x) * sin(y) * cos(z) + sin(x) * sin(z)],
    [cos(y) * sin(z), sin(x) * sin(y) * sin(z) + cos(x) * cos(z), cos(x) * sin(y) * sin(z) - sin(x) * cos(z)],
    [-sin(y), sin(x) * cos(y), cos(x) * cos(y)],
  ])
  return mx
}


function rotate_only_z(angle) {
  let mx = m.matrix([
    [cos(angle), -sin(angle), 0],
    [sin(angle), cos(angle), 0],
    [0, 0, 1],
  ])
  return mx
}

//# make 4x4 matrix
function make_tilt_and_offset(offset, tilt) {
  let mx = m.identity(4)
  let r = rotate_xyz(tilt)
  //mx[:3, :3] = r
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      mx.set([i, j], r.get([i, j]))

  //mx[:3, 3] = offset
  for (let i = 0; i < 3; i++)
    mx.set([i, 3], offset[i])
  return mx
}

//# make 4x4 matrix
function make_rotate_z(angle) {
  let mx = m.identity(4)
  //mx[:3,:3] = rotate_only_z(angle)
  let r = rotate_only_z(angle)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      mx.set([i, j], r.get([i, j]))

  return mx
}

//# make 4x4 matrix
function make_add_radius(R) {
  let mx = m.identity(4)
  mx.set([0, 3], R)
  return mx
}

class Orbit {
  constructor(offset, tilt, radius) {
    this._radius = make_add_radius(radius)
    this._rotate = make_rotate_z(0)
    this._tilt_and_offset = make_tilt_and_offset(offset, tilt)
  }

  rotate(angle) {
    this._rotate = make_rotate_z(angle)
    return this
  }

  transform(vec) {
    return this.transform_each(vec)
  }

  transform_each(vec) {
    var vec = m.multiply(this._radius, vec)
    vec = m.multiply(this._rotate, vec)
    vec = m.multiply(this._tilt_and_offset, vec)
    return vec
  }

  itransform(vec) {
    vec = m.multiply(m.inv(this._tilt_and_offset), vec)
    vec = m.multiply(m.inv(this._rotate), vec)
    vec = m.multiply(m.inv(this._radius), vec)
    return vec
  }

  __copy__() {
    c = Orbit([0, 0, 0], 0, 0, 0)
    c._radius = copy(this._radius)
    c._rotate = copy(this._rotate)
    c._tilt_and_offset = copy(this._tilt_and_offset)
    return c
  }
}

class TimedOrbit {
  constructor(orbit, speed, offset) {
    this._orbit = orbit
    this._speed = speed
    this._offset = offset

    //# update rotation to zero-time
    this._orbit.rotate(-offset)
  }

  set_time(time) {
    this._orbit.rotate(time * this._speed - this._offset)
    return this
  }

  transform(vec) {
    return this._orbit.transform(vec)
  }

  itransform(vec) {
    return this._orbit.itransform(vec)

  }

  __copy__() {
    var c = TimedOrbit(this._orbit.__copy(), this._speed, this._offset)
    return c
  }
}

class TimedNode {
  constructor(name, orbit) {
    this._name = name
    this._orbit = orbit
    this._parent = null
    this._children = []
  }

  set_children(children) {
    //#TODO clear parent in replaced
    this._children = children
    for (let c of this._children)
      c._parent = this
    return this
  }

  map_names(name_to_node = {}) {
    name_to_node[this._name] = this
    for (let c of this._children)
      c.map_names(name_to_node)
    return name_to_node
  }

  //# set your time and pass it to children
  set_time(time) {
    this._orbit.set_time(time)
    for (let c of this._children)
      c.set_time(time)
    return this
  }

  //# do a transformation, pass it down the tree and return
  transform(vec) {
    var vec = this._orbit.transform(vec)
    if (this._parent)
      vec = this._parent.transform(vec)
    return vec
  }

  itransform(vec) {
    var vec = []
    if (this._parent)
      vec = this._parent.itransform(vec)
    vec = this._orbit.itransform(vec)
    return vec
  }

  pos() {
    return this.transform(ZE)
  }
}

async function load_celestials() {
  let r = await fetch("https://github.com/pholmq/tsnext-vite/raw/master/src/settings/celestial-settings.json")
  return await r.json()
}

function build_timed_system(system, celestials) {
  let c = celestials.get(system.name)

  let zerofill = v => typeof v === 'undefined' ? 0 : v

  let center = "abc".split("").map(l => c["orbitCenter" + l])
  let tilt = "abc".split("").map(l => c["orbitTilt" + l])
  let radius = c["orbitRadius"]
  let start = c["startPos"]
  let speed = c["speed"]

  // fill undefined values
  center = center.map(zerofill)
  tilt = tilt.map(zerofill)

  // convert from degrees to radians
  tilt = tilt.map(rad)
  start = rad(start)

  // system is "left handed" (clockwise rotation is positive)
  // so we need to invert all angles / speeds
  tilt = m.multiply(tilt, -1)
  speed *= -1
  start *= -1

  // build orbit
  let o = new Orbit(center, tilt, radius)
  // now timed orbit with rotation speed and startPos
  let to = new TimedOrbit(o, speed, start)
  // system node that has name and children and parent
  // (to propagate time and transformations)
  let tn = new TimedNode(system.name, to)
  if (system.orbits) {
    let children = system.orbits.map(c => build_timed_system(c, celestials))
    tn.set_children(children)
  }

  return tn
}

async function load_solar_system() {
  let celestials = await load_celestials()
  celestials = new Map(celestials.map(c => [c.name, c]))
  let system = {
    'name': 'SystemCenter',
    'orbits': [{
      'name': 'Earth',
      'orbits': [{
        'name': 'Moon deferent A',
        'orbits': [{ 'name': 'Moon deferent B', 'orbits': [{ 'name': 'Moon' }] }]
      },
      {
        'name': 'Sun deferent',
        'orbits': [{
          'name': 'Sun',
          'orbits': [{
            'name': 'Jupiter deferent',
            'orbits': [{ 'name': 'Jupiter' }]
          },
          { 'name': 'Saturn deferent', 'orbits': [{ 'name': 'Saturn' }] },
          { 'name': 'Halleys deferent', 'orbits': [{ 'name': 'Halleys' }] }]
        }]
      },
      {
        'name': 'Venus deferent A',
        'orbits': [{ 'name': 'Venus deferent B', 'orbits': [{ 'name': 'Venus' }] }]
      },
      {
        'name': 'Mercury def A',
        'orbits': [{ 'name': 'Mercury def B', 'orbits': [{ 'name': 'Mercury' }] }]
      },
      {
        'name': 'Mars E deferent',
        'orbits': [{ 'name': 'Mars S deferent', 'orbits': [{ 'name': 'Mars' }] }]
      },
      {
        'name': 'Eros deferent A',
        'orbits': [{ 'name': 'Eros deferent B', 'orbits': [{ 'name': 'Eros' }] }]
      }]
    }]
  }
  return build_timed_system(system, celestials)
}

module.exports = {
  Orbit, TimedOrbit, TimedNode, ZE, load_solar_system, ts_to_pos, zero_timestamp
}

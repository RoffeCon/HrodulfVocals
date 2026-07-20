const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JsonStore {
  constructor(filename, dataDir) {
    this.file = path.join(dataDir, filename);
    this._ensure();
    this.data = this._read();
    this._writeQueue = Promise.resolve();
  }

  _ensure() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '[]', 'utf8');
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw || '[]');
    } catch (e) {
      // Om filen skulle vara trasig, bevara den trasiga versionen och börja om,
      // hellre än att krascha appen och riskera att låsa ute dig från din data.
      const backup = this.file + '.corrupt-' + Date.now();
      try { fs.copyFileSync(this.file, backup); } catch (_) {}
      console.error(`Varning: ${this.file} kunde inte tolkas som JSON, säkerhetskopierade till ${backup}`);
      return [];
    }
  }

  _writeAtomic(data) {
    this._writeQueue = this._writeQueue.then(() => new Promise((resolve, reject) => {
      const tmp = this.file + '.tmp-' + crypto.randomBytes(4).toString('hex');
      fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8', (err) => {
        if (err) return reject(err);
        fs.rename(tmp, this.file, (err2) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    }));
    return this._writeQueue;
  }

  all() {
    return this.data;
  }

  get(id) {
    return this.data.find(x => x.id === id) || null;
  }

  async insert(item) {
    this.data.push(item);
    await this._writeAtomic(this.data);
    return item;
  }

  async update(id, patch) {
    const idx = this.data.findIndex(x => x.id === id);
    if (idx === -1) return null;
    this.data[idx] = { ...this.data[idx], ...patch, id };
    await this._writeAtomic(this.data);
    return this.data[idx];
  }

  async remove(id) {
    const before = this.data.length;
    this.data = this.data.filter(x => x.id !== id);
    if (this.data.length === before) return false;
    await this._writeAtomic(this.data);
    return true;
  }

  // Ersätter all data på en gång - används vid återställning från backup.
  async replaceAll(items) {
    this.data = Array.isArray(items) ? items : [];
    await this._writeAtomic(this.data);
    return this.data;
  }
}

function makeId() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = { JsonStore, makeId };

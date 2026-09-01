const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Datastore = require('nedb-promises');

let isMongoConnected = false;
let FileModel = null;
let localDb = null;

// Skema Mongoose jika terhubung ke MongoDB
const fileSchema = new mongoose.Schema({
    fs_id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    category: { type: String, default: 'other' },
    size: { type: Number, default: 0 },
    size_formatted: { type: String, default: '0 B' },
    thumbnail: { type: String, default: '' },
    stream_url: { type: String, default: '' },
    dlink: { type: String, default: '' },
    path: { type: String, default: '/' },
    source_type: { type: String, default: 'link' }, // 'link' | 'folder' | 'account'
    shareid: { type: String, default: '' },
    uk: { type: String, default: '' },
    sign: { type: String, default: '' },
    timestamp: { type: Number, default: 0 },
    tags: [{ type: String }],
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

async function initDB() {
    const mongoUri = process.env.MONGODB_URI;

    if (mongoUri && mongoUri.trim().length > 0) {
        try {
            console.log('[*] Menghubungkan ke MongoDB...', mongoUri);
            await mongoose.connect(mongoUri.trim(), { serverSelectionTimeoutMS: 5000 });
            isMongoConnected = true;
            FileModel = mongoose.model('File', fileSchema);
            console.log('[✓] Berhasil terhubung ke MongoDB database!');
            return;
        } catch (err) {
            console.warn('[!] Gagal terhubung ke MongoDB, beralih ke Local Embedded Database...');
        }
    }

    // Fallback: Local Embedded DB
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'database.db');
    localDb = Datastore.create({ filename: dbPath, autoload: true });
    console.log(`[✓] Berhasil menginisialisasi Local Embedded Database: ${dbPath}`);
}

async function insertOrUpdateFile(fileData) {
    fileData.updated_at = new Date();
    if (!fileData.created_at) fileData.created_at = new Date();

    if (isMongoConnected && FileModel) {
        return await FileModel.findOneAndUpdate(
            { fs_id: fileData.fs_id },
            { $set: fileData },
            { upsert: true, new: true }
        );
    } else {
        const existing = await localDb.findOne({ fs_id: fileData.fs_id });
        if (existing) {
            await localDb.update({ fs_id: fileData.fs_id }, { $set: fileData });
            return await localDb.findOne({ fs_id: fileData.fs_id });
        } else {
            return await localDb.insert(fileData);
        }
    }
}

async function insertBatchFiles(filesList) {
    const results = [];
    for (const f of filesList) {
        const doc = await insertOrUpdateFile(f);
        results.push(doc);
    }
    return results;
}

async function getFiles({ search = '', category = '', page = 1, limit = 24, sort = 'newest' }) {
    const query = {};
    if (search) {
        query.title = isMongoConnected 
            ? { $regex: search, $options: 'i' } 
            : new RegExp(search, 'i');
    }
    if (category && category !== 'all') {
        query.category = category;
    }

    let sortObj = { created_at: -1 };
    if (sort === 'oldest') sortObj = { created_at: 1 };
    if (sort === 'size_desc') sortObj = { size: -1 };
    if (sort === 'size_asc') sortObj = { size: 1 };
    if (sort === 'title_asc') sortObj = { title: 1 };

    const skip = (page - 1) * limit;

    if (isMongoConnected && FileModel) {
        const total = await FileModel.countDocuments(query);
        const files = await FileModel.find(query).sort(sortObj).skip(skip).limit(limit);
        return { total, page, limit, totalPages: Math.ceil(total / limit), files };
    } else {
        const total = await localDb.count(query);
        const files = await localDb.find(query).sort(sortObj).skip(skip).limit(limit);
        return { total, page, limit, totalPages: Math.ceil(total / limit), files };
    }
}

async function getFileById(id) {
    if (isMongoConnected && FileModel) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            return await FileModel.findById(id);
        }
        return await FileModel.findOne({ fs_id: id });
    } else {
        return await localDb.findOne({ $or: [{ _id: id }, { fs_id: id }] });
    }
}

async function updateFile(id, updateData) {
    updateData.updated_at = new Date();
    if (isMongoConnected && FileModel) {
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { fs_id: id };
        return await FileModel.findOneAndUpdate(query, { $set: updateData }, { new: true });
    } else {
        await localDb.update({ $or: [{ _id: id }, { fs_id: id }] }, { $set: updateData });
        return await localDb.findOne({ $or: [{ _id: id }, { fs_id: id }] });
    }
}

async function deleteFile(id) {
    if (isMongoConnected && FileModel) {
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { fs_id: id };
        const res = await FileModel.deleteOne(query);
        return res.deletedCount > 0;
    } else {
        const count = await localDb.remove({ $or: [{ _id: id }, { fs_id: id }] }, {});
        return count > 0;
    }
}

async function getStats() {
    if (isMongoConnected && FileModel) {
        const totalFiles = await FileModel.countDocuments();
        const totalVideos = await FileModel.countDocuments({ category: 'video' });
        const sizeAgg = await FileModel.aggregate([{ $group: { _id: null, totalSize: { $sum: '$size' } } }]);
        const totalSize = sizeAgg.length > 0 ? sizeAgg[0].totalSize : 0;
        return { totalFiles, totalVideos, totalSize, isMongoDB: true };
    } else {
        const totalFiles = await localDb.count({});
        const totalVideos = await localDb.count({ category: 'video' });
        const allDocs = await localDb.find({});
        const totalSize = allDocs.reduce((acc, cur) => acc + (cur.size || 0), 0);
        return { totalFiles, totalVideos, totalSize, isMongoDB: false };
    }
}

module.exports = {
    initDB,
    insertOrUpdateFile,
    insertBatchFiles,
    getFiles,
    getFileById,
    updateFile,
    deleteFile,
    getStats
};

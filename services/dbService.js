const mongoose = require('mongoose');
const Datastore = require('nedb-promises');
const path = require('path');

let isMongoDB = false;
let FileModel = null;
let localDB = null;

// Schema MongoDB
const fileSchema = new mongoose.Schema({
    fs_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, index: true },
    category: { type: String, default: 'video', index: true },
    size: { type: Number, default: 0 },
    size_formatted: { type: String, default: '0 B' },
    thumbnail: { type: String, default: '' },
    stream_url: { type: String, default: '' },
    share_url: { type: String, default: '' },
    surl: { type: String, default: '' },
    dlink: { type: String, default: '' },
    path: { type: String, default: '/', index: true },
    source_type: { type: String, default: 'link' },
    shareid: { type: String, default: '' },
    uk: { type: String, default: '' },
    sign: { type: String, default: '' },
    timestamp: { type: Number, default: 0 },
    tags: [{ type: String }],
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

fileSchema.pre('save', function(next) {
    this.updated_at = Date.now();
    next();
});

async function initDB() {
    const mongoUri = process.env.MONGODB_URI;
    if (mongoUri) {
        try {
            console.log(`[*] Menghubungkan ke MongoDB... ${mongoUri.replace(/:([^:@]+)@/, ':****@')}`);
            await mongoose.connect(mongoUri, {
                serverSelectionTimeoutMS: 5000
            });
            isMongoDB = true;
            FileModel = mongoose.models.File || mongoose.model('File', fileSchema);
            console.log(`[✓] Berhasil terhubung ke MongoDB database!`);
            return;
        } catch (err) {
            console.warn(`[!] Gagal terhubung ke MongoDB: ${err.message}. Menggunakan database lokal (NeDB fallback)...`);
        }
    } else {
        console.log(`[*] Tidak ada MONGODB_URI di .env. Menggunakan database lokal NeDB.`);
    }

    // Fallback ke Embedded Local Database
    const dbPath = path.join(__dirname, '..', 'data', 'terabox_files.db');
    localDB = Datastore.create({
        filename: dbPath,
        autoload: true
    });
    console.log(`[✓] Database lokal NeDB aktif di: ${dbPath}`);
}

/**
 * Insert or Update single file (Upsert) - Hanya Video
 */
async function insertOrUpdateFile(fileData) {
    fileData.category = 'video';
    fileData.updated_at = new Date();

    if (isMongoDB && FileModel) {
        const result = await FileModel.findOneAndUpdate(
            { fs_id: fileData.fs_id },
            { $set: fileData },
            { upsert: true, new: true }
        );
        return result;
    } else if (localDB) {
        const existing = await localDB.findOne({ fs_id: fileData.fs_id });
        if (existing) {
            await localDB.update({ fs_id: fileData.fs_id }, { $set: fileData });
            return await localDB.findOne({ fs_id: fileData.fs_id });
        } else {
            fileData.created_at = new Date();
            return await localDB.insert(fileData);
        }
    }
}

/**
 * Insert or Update multiple files (Bulk Upsert) - Hanya Video
 */
async function insertBatchFiles(filesList) {
    if (!filesList || filesList.length === 0) return [];

    const savedFiles = [];
    for (const f of filesList) {
        try {
            const saved = await insertOrUpdateFile(f);
            savedFiles.push(saved);
        } catch (e) {
            console.error(`Error saving file ${f.title}:`, e.message);
        }
    }
    return savedFiles;
}

/**
 * Query Files (Pencarian & Pagination) - Default Selalu Video
 */
async function getFiles({ search = '', category = 'video', page = 1, limit = 24, sort = 'newest' }) {
    const query = { category: 'video' };

    if (search && search.trim() !== '') {
        const regex = new RegExp(search.trim(), 'i');
        query.$or = [{ title: regex }, { path: regex }];
    }

    let sortOption = { created_at: -1 };
    if (sort === 'oldest') sortOption = { created_at: 1 };
    if (sort === 'size_desc') sortOption = { size: -1 };
    if (sort === 'size_asc') sortOption = { size: 1 };
    if (sort === 'title_asc') sortOption = { title: 1 };

    const skip = (page - 1) * limit;

    if (isMongoDB && FileModel) {
        const total = await FileModel.countDocuments(query);
        const files = await FileModel.find(query)
            .sort(sortOption)
            .skip(skip)
            .limit(limit)
            .lean();

        return {
            files,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / limit)
        };
    } else if (localDB) {
        const total = await localDB.count(query);
        let cursor = localDB.find(query);
        cursor = cursor.sort(sortOption).skip(skip).limit(limit);
        const files = await cursor;

        return {
            files,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / limit)
        };
    }
    return { files: [], total: 0, page: 1, totalPages: 0 };
}

/**
 * Get File By ID (MongoDB _id atau NeDB _id atau fs_id)
 */
async function getFileById(id) {
    if (isMongoDB && FileModel) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            const byId = await FileModel.findById(id).lean();
            if (byId) return byId;
        }
        return await FileModel.findOne({ fs_id: id }).lean();
    } else if (localDB) {
        let file = await localDB.findOne({ _id: id });
        if (!file) file = await localDB.findOne({ fs_id: id });
        return file;
    }
    return null;
}

/**
 * Update File Metadata
 */
async function updateFile(id, updateData) {
    updateData.updated_at = new Date();
    if (isMongoDB && FileModel) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            return await FileModel.findByIdAndUpdate(id, { $set: updateData }, { new: true }).lean();
        }
        return await FileModel.findOneAndUpdate({ fs_id: id }, { $set: updateData }, { new: true }).lean();
    } else if (localDB) {
        await localDB.update({ _id: id }, { $set: updateData });
        return await localDB.findOne({ _id: id });
    }
    return null;
}

/**
 * Delete File Record
 */
async function deleteFile(id) {
    if (isMongoDB && FileModel) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            return await FileModel.findByIdAndDelete(id);
        }
        return await FileModel.findOneAndDelete({ fs_id: id });
    } else if (localDB) {
        return await localDB.remove({ _id: id });
    }
    return false;
}

/**
 * Get Database Statistics
 */
async function getStats() {
    if (isMongoDB && FileModel) {
        const totalFiles = await FileModel.countDocuments({ category: 'video' });
        const totalVideos = totalFiles;
        const sizeResult = await FileModel.aggregate([
            { $match: { category: 'video' } },
            { $group: { _id: null, totalSize: { $sum: '$size' } } }
        ]);
        const totalSize = sizeResult.length > 0 ? sizeResult[0].totalSize : 0;

        return {
            totalFiles,
            totalVideos,
            totalSize,
            isMongoDB: true
        };
    } else if (localDB) {
        const totalFiles = await localDB.count({ category: 'video' });
        const allDocs = await localDB.find({ category: 'video' });
        const totalSize = allDocs.reduce((acc, curr) => acc + (curr.size || 0), 0);

        return {
            totalFiles,
            totalVideos: totalFiles,
            totalSize,
            isMongoDB: false
        };
    }

    return { totalFiles: 0, totalVideos: 0, totalSize: 0, isMongoDB: false };
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

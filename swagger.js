const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'TeraCloud REST API & Video Streaming Engine',
    version: '1.0.0',
    description: 'Dokumentasi REST API lengkap untuk Terabox Downloader, Indexer, HLS Video Streaming & CRUD Database Management.'
  },
  servers: [
    {
      url: '/',
      description: 'Current Server Host'
    }
  ],
  tags: [
    { name: 'System & Stats', description: 'Informasi status sistem, database, dan akun Terabox' },
    { name: 'Fetch Engine', description: 'Ekstraksi & sinkronisasi metadata Terabox ke MongoDB' },
    { name: 'Database Files (CRUD)', description: 'Manajemen data file di database' },
    { name: 'Streaming & Video', description: 'HLS Video Stream Manifest & TS Chunk Proxy' }
  ],
  paths: {
    '/api/stats': {
      get: {
        tags: ['System & Stats'],
        summary: 'Mendapatkan statistik ringkasan database & akun',
        responses: {
          '200': {
            description: 'Statistik database dan status login Terabox'
          }
        }
      }
    },
    '/api/cookie': {
      get: {
        tags: ['System & Stats'],
        summary: 'Mengecek ketersediaan & validitas cookie akun Terabox',
        responses: {
          '200': { description: 'Status cookie' }
        }
      },
      post: {
        tags: ['System & Stats'],
        summary: 'Menyimpan atau memperbarui cookie Terabox',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  cookie: { type: 'string', example: 'ndus=Yafg872hfsdh87...' }
                },
                required: ['cookie']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Cookie berhasil disimpan' }
        }
      }
    },
    '/api/folders': {
      get: {
        tags: ['System & Stats'],
        summary: 'Mendapatkan daftar folder yang ada di akun Terabox',
        responses: {
          '200': { description: 'Daftar folder akun' }
        }
      }
    },
    '/api/fetch/link': {
      post: {
        tags: ['Fetch Engine'],
        summary: 'Ekstrak file dari Share Link Terabox & simpan ke DB',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', example: 'https://1024terabox.com/s/1BvkT95h3-4-fq5iQZ__0_A' }
                },
                required: ['url']
              }
            }
          }
        },
        responses: {
          '200': { description: 'File berhasil diambil dan disimpan ke database' }
        }
      }
    },
    '/api/fetch/folder': {
      post: {
        tags: ['Fetch Engine'],
        summary: 'Pindai dan simpan seluruh file di dalam folder akun Terabox',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  folderPath: { type: 'string', example: '/syumildee' },
                  recursive: { type: 'boolean', example: true }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'File dalam folder berhasil disimpan' }
        }
      }
    },
    '/api/fetch/folder/stream': {
      get: {
        tags: ['Fetch Engine'],
        summary: 'SSE Stream: Pindai folder dengan event progress real-time',
        parameters: [
          { name: 'folderPath', in: 'query', schema: { type: 'string', default: '/' } },
          { name: 'recursive', in: 'query', schema: { type: 'string', default: 'true' } }
        ],
        responses: {
          '200': { description: 'Server-Sent Events stream' }
        }
      }
    },
    '/api/fetch/account': {
      post: {
        tags: ['Fetch Engine'],
        summary: 'Pindai seluruh isi folder dan file di akun Terabox ke DB',
        responses: {
          '200': { description: 'Sinkronisasi seluruh akun selesai' }
        }
      }
    },
    '/api/fetch/account/stream': {
      get: {
        tags: ['Fetch Engine'],
        summary: 'SSE Stream: Pindai seluruh akun dengan progress bar real-time',
        responses: {
          '200': { description: 'Server-Sent Events stream' }
        }
      }
    },
    '/api/files': {
      get: {
        tags: ['Database Files (CRUD)'],
        summary: 'List file dari database dengan pencarian, filter, & pagination',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Cari berdasarkan judul file' },
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['all', 'video', 'image', 'document', 'audio', 'other'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest', 'size_desc', 'size_asc', 'title_asc'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 24 } }
        ],
        responses: {
          '200': { description: 'Daftar record file dalam format JSON' }
        }
      },
      post: {
        tags: ['Database Files (CRUD)'],
        summary: 'Tambah data record file secara manual',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fs_id: { type: 'string', example: '1092109922764946' },
                  title: { type: 'string', example: 'video_sample.mp4' },
                  category: { type: 'string', example: 'video' },
                  size: { type: 'number', example: 15315567 },
                  thumbnail: { type: 'string' }
                },
                required: ['fs_id', 'title']
              }
            }
          }
        },
        responses: {
          '200': { description: 'File manual berhasil disimpan' }
        }
      }
    },
    '/api/files/{id}': {
      get: {
        tags: ['Database Files (CRUD)'],
        summary: 'Mendapatkan detail metadata 1 file berdasarkan ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Detail metadata file' }
        }
      },
      put: {
        tags: ['Database Files (CRUD)'],
        summary: 'Memperbarui judul / kategori file',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Metadata file berhasil diperbarui' }
        }
      },
      delete: {
        tags: ['Database Files (CRUD)'],
        summary: 'Menghapus file dari database',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'File berhasil dihapus dari database' }
        }
      }
    },
    '/api/stream/{id}': {
      get: {
        tags: ['Streaming & Video'],
        summary: 'Mendapatkan HLS Video Stream Manifest (.m3u8) - Anti-Expired',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Playlist HLS M3U8 manifest',
            content: {
              'application/vnd.apple.mpegurl': {
                schema: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
};

module.exports = swaggerDocument;

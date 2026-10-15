import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors';
import { can } from '../rbac/access';
import { RbacService } from '../rbac/rbac.service';
import { RawFileQuery, UploadFileDto } from './files.dto';
import { FilesService, type UploadedBlob } from './files.service';

const uuid = new ParseUUIDPipe();
/** Multer chegarasi — servis aniq chegarani (UPLOAD_MAX_MB) tekshiradi; bu faqat xotirani himoya qiladi. */
const HARD_LIMIT = 50 * 1024 * 1024;

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly rbac: RbacService,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'purpose'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'JPEG/PNG/WEBP (chek va hujjat uchun PDF ham)' },
        purpose: { type: 'string', enum: ['RECEIPT', 'CLUB_MEDIA', 'CLUB_DOCUMENT'] },
        club_id: { type: 'string', format: 'uuid', description: 'CLUB_MEDIA / CLUB_DOCUMENT uchun majburiy' },
      },
    },
  })
  @ApiOperation({ summary: "Fayl yuklash (multipart: file, purpose, club_id?) — chek, logo, hujjat" })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT, files: 1 } }))
  async upload(@UploadedFile() file: UploadedBlob | undefined, @Body() dto: UploadFileDto, @CurrentUser() u: AuthUser) {
    if (!file) throw new AppException('VALIDATION_ERROR', 'File is required', { field: 'file' });
    let clubId: string | null = null;
    if (dto.purpose !== 'RECEIPT') {
      if (!dto.club_id) throw new AppException('VALIDATION_ERROR', 'club_id is required', { field: 'club_id' });
      const perm = dto.purpose === 'CLUB_MEDIA' ? 'clubs.update' : 'clubs.documents.manage';
      if (!can(await this.rbac.grants(u.id), perm, { club_id: dto.club_id })) throw new AppException('NOT_FOUND', 'Club not found');
      clubId = dto.club_id;
    }
    const f = await this.files.upload(u.id, dto.purpose, file, clubId);
    return { id: f.id, purpose: f.purpose, mime: f.mime, size: f.size, original_name: f.original_name, url: this.files.url(f), public_url: f.purpose === 'CLUB_MEDIA' ? this.files.publicUrl(f) : null };
  }

  @Get(':id') @ApiOperation({ summary: 'Fayl ma\'lumoti + vaqtinchalik havola (egasi yoki vakolatli xodim)' })
  async meta(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.files.meta(id, u.id, await this.rbac.grants(u.id));
  }

  @Public() @Get(':id/raw') @ApiOperation({ summary: 'Fayl tarkibi: ommaviy (CLUB_MEDIA) yoki imzolangan havola' })
  async raw(@Param('id', uuid) id: string, @Query() q: RawFileQuery, @Res() res: Response) {
    const { file, body } = await this.files.raw(id, q.exp, q.sig);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // PDF/rasm brauzerda ochiladi, lekin sahifa sifatida skript bajarmaydi
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${file.id}.${file.mime === 'application/pdf' ? 'pdf' : file.mime.split('/')[1]}"`);
    res.setHeader('Cache-Control', file.purpose === 'CLUB_MEDIA' ? 'public, max-age=86400' : 'private, max-age=600');
    res.send(body);
  }
}

import type { Prisma, User } from '@prisma/client';
import { prisma } from '../db';

/**
 * users 테이블에 대한 DB 질의 함수.
 * 라우트는 SQL/Prisma API 를 직접 보지 않고 이 함수만 호출한다.
 */

export function findAllUsers(): Promise<User[]> {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
}

export function findUserById(id: number): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function createUser(input: Prisma.UserCreateInput): Promise<User> {
  return prisma.user.create({ data: input });
}

export function updateUser(
  id: number,
  patch: Prisma.UserUpdateInput,
): Promise<User> {
  return prisma.user.update({ where: { id }, data: patch });
}

export function deleteUser(id: number): Promise<User> {
  return prisma.user.delete({ where: { id } });
}

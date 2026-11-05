'use client';

import { useEffect, useState } from 'react';
import { AdminGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';

type Stats = {
  users: { total: number; admins: number; active: number; connectedYouTube: number };
  videos: { total: number; pending: number; processing: number; completed: number; failed: number };
};

type UserRow = {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  isActive: boolean;
  subscription?: { plan: string; status: string };
};

type VideoRow = {
  _id: string;
  title: string;
  status: string;
  user?: { name?: string; email?: string };
  createdAt?: string;
};

export default function AdminPage() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [s, u, v] = await Promise.all([
      api.get<Stats>('/api/admin/stats'),
      api.get<{ items: UserRow[] }>('/api/admin/users'),
      api.get<{ items: VideoRow[] }>('/api/admin/videos'),
    ]);
    if (s.success) setStats(s.data as Stats);
    else toast.error(s.message || 'Failed to load stats.');
    if (u.success) setUsers((u.data as { items: UserRow[] }).items || []);
    else toast.error(u.message || 'Failed to load users.');
    if (v.success) setVideos((v.data as { items: VideoRow[] }).items || []);
    else toast.error(v.message || 'Failed to load videos.');
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleRole = async (id: string, role: 'user' | 'admin') => {
    const newRole = role === 'admin' ? 'user' : 'admin';
    const res = await api.patch(`/api/admin/users/${id}/role`, { role: newRole });
    if (res.success) {
      toast.success(res.message || `Role updated to ${newRole}.`);
    } else {
      toast.error(res.message || 'Failed to update user role.');
    }
    await load();
  };

  const toggleStatus = async (id: string, isActive: boolean) => {
    const next = !isActive;
    const res = await api.patch(`/api/admin/users/${id}/status`, { isActive: next });
    if (res.success) {
      toast.success(res.message || `User ${next ? 'activated' : 'deactivated'}.`);
    } else {
      toast.error(res.message || 'Failed to update user status.');
    }
    await load();
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
            <a href="/dashboard" className="text-sm underline">Back to app</a>
          </div>
        </header>

        <main className="mx-auto max-w-6xl p-4 space-y-6">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Users</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats.users.total}</p>
                  <p className="text-xs text-muted-foreground">{stats.users.admins} admins • {stats.users.active} active</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">YouTube Connected</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats.users.connectedYouTube}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Videos</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats.videos.total}</p>
                  <p className="text-xs text-muted-foreground">
                    {stats.videos.completed} done • {stats.videos.failed} failed
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Processing</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats.videos.processing}</p>
                  <p className="text-xs text-muted-foreground">{stats.videos.pending} pending</p>
                </CardContent>
              </Card>
            </div>
          )}

          <Tabs defaultValue="users">
            <TabsList>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="videos">Videos</TabsTrigger>
            </TabsList>

            <TabsContent value="users">
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u._id}>
                          <TableCell>{u.name}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell>
                            <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.isActive ? 'outline' : 'destructive'}>
                              {u.isActive ? 'active' : 'disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell>{u.subscription?.plan}</TableCell>
                          <TableCell className="space-x-2">
                            <Button size="sm" variant="outline" onClick={() => toggleRole(u._id, u.role)}>
                              Make {u.role === 'admin' ? 'user' : 'admin'}
                            </Button>
                            <Button
                              size="sm"
                              variant={u.isActive ? 'destructive' : 'default'}
                              onClick={() => toggleStatus(u._id, u.isActive)}
                            >
                              {u.isActive ? 'Disable' : 'Enable'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="videos">
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {videos.map((v) => (
                        <TableRow key={v._id}>
                          <TableCell>{v.title}</TableCell>
                          <TableCell>{v.user?.email || v.user?.name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={v.status === 'completed' ? 'default' : 'secondary'}>{v.status}</Badge>
                          </TableCell>
                          <TableCell>{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</TableCell>
                        </TableRow>
                      ))}
                      {videos.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground">
                            No videos yet
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </AdminGuard>
  );
}
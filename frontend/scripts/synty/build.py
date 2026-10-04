"""Blender (5.x) build of all web models from the extracted Synty FBX files.
   blender -b --factory-startup -P build.py -- <src dir> <out dir>
Outputs (all metres, +Y up, facing +X, base at y = 0):
  dog.glb              skinned German Shepherd + rescue vest, NLA animations (idle, sniff, walk, run, bark, sit, wag)
  handler.glb          static, police K9 handler
  child_marker.glb     static, kid in a yellow raincoat (standing)
  tree_conifer.glb, tree_broadleaf.glb, shrub.glb, tent.glb   single-mesh props for the planner
  kit.glb              every prop + posed characters as named top-level nodes for the landing scene
"""
import bpy, sys, math, os, mathutils

SRC, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
A, K, D = f'{SRC}/adv', f'{SRC}/kids', f'{SRC}/dog'
os.makedirs(OUT, exist_ok=True)

FACE_X = mathutils.Matrix.Rotation(math.radians(90), 4, 'Z')  # Synty faces -Y in Blender after import -> +X


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


MATS = {}


def atlas(path, size=256):
    if path in MATS:
        return MATS[path]
    img = bpy.data.images.load(path)
    if img.size[0] > size:
        img.scale(size, size)
    img.name = os.path.splitext(os.path.basename(path))[0]
    m = bpy.data.materials.new(img.name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    t.interpolation = 'Closest'
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Metallic'].default_value = 0.0
    MATS[path] = m
    return m


def imported(fn):
    before = {o.name for o in bpy.data.objects}
    fn()
    return [o for o in bpy.data.objects if o.name not in before]


def alive(objs):
    out = []
    for o in objs:
        try:
            if o.name in bpy.data.objects:
                out.append(o)
        except ReferenceError:
            pass
    return out


def bake_to(objs, name):
    """Evaluated meshes (modifiers applied) -> one static object in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    parts = []
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
        me.transform(o.matrix_world)
        nb = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(nb)
        parts.append(nb)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def ground(ob, rotate=True):
    """Face +X, centre on XY, base at z = 0 (mesh data only, object transform identity)."""
    if rotate:
        ob.data.transform(FACE_X)
    ps = [v.co for v in ob.data.vertices]
    mn = mathutils.Vector([min(p[i] for p in ps) for i in range(3)])
    mx = mathutils.Vector([max(p[i] for p in ps) for i in range(3)])
    ob.data.transform(mathutils.Matrix.Translation(-mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    ob.matrix_world = mathutils.Matrix.Identity(4)
    print(f'  {ob.name:22} dims', [round(d, 2) for d in (mx - mn)], 'tris', sum(len(p.vertices) - 2 for p in ob.data.polygons))
    return ob


def prop(fbx, tex, name, rotate=False):
    """A static Synty prop as one grounded mesh with the given atlas."""
    new = imported(lambda: bpy.ops.import_scene.fbx(filepath=fbx))
    meshes = [o for o in new if o.type == 'MESH' and 'Collision' not in o.name and 'Convex' not in o.name]
    m = atlas(tex)
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(m)
    ob = bake_to(meshes, name)
    for o in alive(new):
        if o != ob:
            bpy.data.objects.remove(o)
    return ground(ob, rotate)


def character(fbx, tex, keep, pose, name, attach=()):
    """A Synty skinned character, posed (bone-local euler degrees) and baked to a static mesh."""
    new = imported(lambda: bpy.ops.import_scene.fbx(filepath=fbx))
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    m = atlas(tex)
    for o in [o for o in new if o.type == 'MESH']:
        if o.name not in keep:
            bpy.data.objects.remove(o)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
    new = alive(new)
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(m)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for b, r in pose.items():
        pb = arm.pose.bones[b]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = [math.radians(a) for a in r]
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    for afbx, bone in attach:
        for o in imported(lambda: bpy.ops.import_scene.fbx(filepath=afbx)):
            if o.type != 'MESH':
                bpy.data.objects.remove(o)
                continue
            o.data.materials.clear()
            o.data.materials.append(m)
            o.matrix_world = mathutils.Matrix.Translation(arm.matrix_world @ arm.pose.bones[bone].head) @ o.matrix_world
            meshes.append(o)
    junk = {o.name for o in alive(meshes + new)}
    ob = bake_to(meshes, name)
    for n in junk:
        if n != ob.name and n in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[n])
    return ground(ob)


def export(path, objs=None, anims=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in (objs or bpy.data.objects):
        # Synty FBX attachments import hidden; hidden objects can't be selected for export
        o.hide_set(False)
        o.hide_viewport = False
        o.hide_render = False
        o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
              export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False,
              export_extras=False, export_animations=anims)
    if anims:
        kw.update(export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True)
    bpy.ops.export_scene.gltf(**kw)
    print('WROTE', path, os.path.getsize(path) // 1024, 'KB')


# ---------- poses (bone-local degrees; Z swings arms/legs sideways, Y swings them forward) ----------
ARMS_DOWN = {'Shoulder_L': [0, 0, -70], 'Shoulder_R': [0, 0, -70]}
P = f'{SRC}/police'
POLICE = dict(fbx=f'{P}/Characters.fbx', tex=f'{P}/PolygonPoliceStation_Texture_01_A.png')
# handlers: police K9 officers (Synty POLYGON Police Station)
HANDLER = dict(**POLICE, keep=['SM_Chr_Officer_Male_01'], attach=[(f'{P}/SM_Chr_Attach_Hat_01.fbx', 'Head')])
HANDLER_F = dict(**POLICE, keep=['SM_Chr_Officer_Female_01'], attach=[(f'{P}/SM_Chr_Attach_Hair_05.fbx', 'Head')])
HANDLER_R = dict(**POLICE, keep=['SM_Chr_Officer_Male_01'], attach=[(f'{P}/SM_Chr_Attach_Hat_05.fbx', 'Head')])
KID = dict(fbx=f'{K}/Characters_Kids.fbx', tex=f'{K}/PolygonKids_Texture_01_A.png',
           keep=['SM_Chr_Kid_Raincoat_01', 'SM_Chr_Eyes_Male_01', 'SM_Chr_Eyebrows_01'])
KID_STAND = {'Shoulder_L': [0, 0, -68], 'Shoulder_R': [0, 0, -68]}
KID_SIT = {'Shoulder_L': [0, 25, -60], 'Shoulder_R': [0, 25, -60], 'Elbow_L': [0, 30, 0], 'Elbow_R': [0, 30, 0],
           'UpperLeg_L': [0, 90, 4], 'UpperLeg_R': [0, 90, -4], 'LowerLeg_L': [0, -90, 0], 'LowerLeg_R': [0, -90, 0],
           'Head': [0, 12, 0]}
KID_WALK = {'Shoulder_L': [0, -25, -70], 'Shoulder_R': [0, 25, -70], 'UpperLeg_L': [0, 28, 0], 'UpperLeg_R': [0, -22, 0],
            'LowerLeg_R': [0, -25, 0], 'LowerLeg_L': [0, -8, 0]}
HANDLER_POINT = {'Shoulder_L': [0, 0, -70], 'Shoulder_R': [0, -72, -8]}

# ---------- single-file models for the planner ----------
print('== planner models')
for fn, (fbx, tex) in {
    'tree_conifer.glb': (f'{A}/SM_Env_TreePine_01.fbx', f'{A}/PolyAdventure_01.png'),
    'tree_broadleaf.glb': (f'{A}/SM_Env_Tree_01.fbx', f'{A}/PolyAdventure_01.png'),
    'shrub.glb': (f'{A}/SM_Env_Bush_01.fbx', f'{A}/PolyAdventure_01.png'),
    'tent.glb': (f'{K}/SM_Prop_Tent_01.fbx', f'{K}/PolygonKids_Texture_01_A.png'),
}.items():
    reset()
    ob = prop(fbx, tex, fn[:-4])
    export(f'{OUT}/{fn}', [ob])

reset()
export(f'{OUT}/handler.glb', [character(pose=ARMS_DOWN, name='handler', **HANDLER)])
reset()
export(f'{OUT}/child_marker.glb', [character(pose=KID_STAND, name='child', **KID)])

# ---------- dog: skinned, rescue vest, animations ----------
print('== dog')
reset()
new = imported(lambda: bpy.ops.import_scene.fbx(filepath=f'{D}/Unity_SK_Animals_Dog_01.fbx'))
arm = [o for o in new if o.type == 'ARMATURE'][0]
arm.name = 'Dog'
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
KEEP_DOG = {'SK_Animal_Dog_GermanShepherd_01': (f'{D}/PolygonDog_GermanShepherd_01.png', 512),
            'SK_Chr_Attach_Vest_Rescue_Shepherd_02': (f'{D}/PolygonDog_01.png', 256)}
for o in [o for o in new if o.type == 'MESH']:
    if o.name not in KEEP_DOG:
        bpy.data.objects.remove(o)
        continue
    tex, size = KEEP_DOG[o.name]
    o.data.materials.clear()
    o.data.materials.append(atlas(tex, size))
vest = bpy.data.objects['SK_Chr_Attach_Vest_Rescue_Shepherd_02']
# the vest's bind is in centimetres, Y-up: bring it into the dog's space (world: x0.01, rotate +90 about X)
mw = vest.matrix_world.copy()
fix = mathutils.Matrix.Rotation(math.radians(90), 4, 'X') @ mathutils.Matrix.Scale(0.01, 4)
vest.data.transform(mw.inverted() @ fix @ mw)
dg = bpy.context.evaluated_depsgraph_get()
for o in (bpy.data.objects['SK_Animal_Dog_GermanShepherd_01'], vest):
    me = o.evaluated_get(dg).to_mesh()
    ps = [o.matrix_world @ v.co for v in me.vertices]
    print('  ', o.name, [round(min(p[i] for p in ps), 2) for i in range(3)], [round(max(p[i] for p in ps), 2) for i in range(3)])
arm.matrix_world = FACE_X @ arm.matrix_world

# clips are ASCII FBX (Blender can't read them): see dog_clips.mjs
export(f'{OUT}/dog.glb', [arm] + [o for o in bpy.data.objects if o.parent == arm])

# ---------- kit: everything for the landing diorama ----------
print('== kit')
reset()
PA, GA, KA = f'{A}/PolyAdventure_01.png', f'{A}/Generic_01_A.png', f'{K}/PolygonKids_Texture_01_A.png'
items = []
for i in range(1, 5):
    items.append(prop(f'{A}/SM_Env_TreePine_0{i}.fbx', PA, f'pine_{i}'))
    items.append(prop(f'{A}/SM_Env_Bush_0{i}.fbx', PA, f'bush_{i}'))
for i in range(1, 4):
    items.append(prop(f'{A}/SM_Env_TreeBirch_0{i}.fbx', PA, f'birch_{i}'))
    items.append(prop(f'{A}/SM_Env_Tree_0{i}.fbx', PA, f'tree_{i}'))
    items.append(prop(f'{A}/SM_Gen_Env_Fern_0{i}.fbx', GA, f'fern_{i}'))
    items.append(prop(f'{A}/SM_Env_Cloud_0{i}.fbx', PA, f'cloud_{i}'))
    items.append(prop(f'{A}/SM_Gen_Env_Rock_0{i}.fbx', GA, f'rock_{i}'))
items += [
    prop(f'{A}/SM_Env_TreeLog_01.fbx', PA, 'log'),
    prop(f'{A}/SM_Env_TreeStump_01.fbx', PA, 'stump'),
    prop(f'{A}/SM_Env_CampFire_01.fbx', PA, 'campfire'),
    prop(f'{A}/SM_Item_Lantern_01.fbx', PA, 'lantern'),
    prop(f'{K}/SM_Prop_Tent_01.fbx', KA, 'tent'),
    prop(f'{K}/SM_Prop_Torch_01.fbx', KA, 'torch'),
    character(pose=KID_SIT, name='kid_sit', **KID),
    character(pose=KID_WALK, name='kid_walk', **KID),
    character(pose=HANDLER_POINT, name='handler_point', **HANDLER),
    character(pose=ARMS_DOWN, name='handler', **HANDLER),
    character(pose=HANDLER_POINT, name='handler_f_point', **HANDLER_F),
    character(pose=ARMS_DOWN, name='handler_f', **HANDLER_F),
    character(pose=HANDLER_POINT, name='handler_r_point', **HANDLER_R),
    character(pose=ARMS_DOWN, name='handler_r', **HANDLER_R),
]
export(f'{OUT}/kit.glb', items)
